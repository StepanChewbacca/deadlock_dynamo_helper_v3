import { Injectable } from '@nestjs/common';
import {
  RecommendationCandidate,
  RecommendationDecisionState,
  reconstructedFact,
  generateRecommendationCandidates,
  projectRecommendationCandidateState,
} from '@deadlock-live-probe/build-domain';
import { AdaptivePlanSessionV1, AdaptivePlanStepV1 } from '@deadlock-live-probe/shared';
import { AdaptiveDecisionStateV1 } from './adaptive-decision-state-v1.service';
import {
  AdaptiveSlotStateV1,
  candidateGeneratorRulesFromSlotStateV1,
  deriveAdaptiveSlotStateV1,
} from './adaptive-economy-v1';
import { planProjectionFromDecisionStateV1 } from './transaction-plan-step-v1';

export interface TransactionPlanViolationV1 {
  stepId?: string;
  code: string;
  reasonCodes: readonly string[];
}

export interface TransactionPlanValidationV1 {
  valid: boolean;
  violations: readonly TransactionPlanViolationV1[];
}

@Injectable()
export class TransactionPlanValidatorV1Service {
  validate(input: {
    session: AdaptivePlanSessionV1;
    decision: AdaptiveDecisionStateV1;
  }): TransactionPlanValidationV1 {
    const violations: TransactionPlanViolationV1[] = [];
    const resolvedStepIds = new Set<string>();
    let state = input.decision.state;
    let slots = input.decision.slots;

    for (const step of input.session.steps) {
      if (step.state === 'INVALIDATED' || step.state === 'SKIPPED') {
        resolvedStepIds.add(step.stepId);
        continue;
      }
      if (step.state === 'COMPLETED') {
        resolvedStepIds.add(step.stepId);
        continue;
      }

      const missingPrerequisites = step.prerequisiteStepIds.filter((stepId) => !resolvedStepIds.has(stepId));
      if (missingPrerequisites.length > 0) {
        violations.push({
          stepId: step.stepId,
          code: 'PREREQUISITE_NOT_SATISFIED',
          reasonCodes: missingPrerequisites.map((stepId) => `MISSING_STEP:${stepId}`),
        });
        continue;
      }

      const rules = candidateGeneratorRulesFromSlotStateV1(slots);
      const before = planProjectionFromDecisionStateV1(state, input.decision.itemGraph, rules);
      if (!sameProjection(before, step.projectedBefore)) {
        violations.push({ stepId: step.stepId, code: 'PROJECTED_BEFORE_MISMATCH', reasonCodes: [] });
      }

      if (step.kind === 'BARRIER') {
        if (!step.barrier) {
          violations.push({ stepId: step.stepId, code: 'BARRIER_MISSING', reasonCodes: [] });
          continue;
        }
        const applied = applyBarrier(step, state, slots, input.decision);
        if (!applied) {
          violations.push({
            stepId: step.stepId,
            code: 'BARRIER_NOT_PROVABLE',
            reasonCodes: step.reasonCodes,
          });
          continue;
        }
        state = applied.state;
        slots = applied.slots;
        resolvedStepIds.add(step.stepId);
        continue;
      }

      if (!step.action) {
        violations.push({ stepId: step.stepId, code: 'TRANSACTION_MISSING', reasonCodes: [] });
        continue;
      }

      const candidate = matchingCandidate(step, state, slots, input.decision);
      if (!candidate || !candidate.feasible || !candidate.recommendationEligible) {
        violations.push({
          stepId: step.stepId,
          code: 'TRANSACTION_NOT_EXECUTABLE',
          reasonCodes: candidate?.reasons ?? ['NO_MATCHING_CANDIDATE'],
        });
        continue;
      }

      const nextState = projectRecommendationCandidateState(state, candidate, input.decision.itemGraph);
      const nextSlots = deriveAdaptiveSlotStateV1(
        [...nextState.inventory.heldByItemId.keys()],
        input.decision.itemGraph,
        {
          baseSlots: slots.baseSlots,
          baseSlotsByType: slots.baseSlotsByType,
          maxFlexSlots: slots.maxFlexSlots,
          maxActiveItems: slots.maxActiveItems,
        },
        { unlockedFlexSlots: slots.unlockedFlexSlots, evidence: slots.evidence },
      );
      const after = planProjectionFromDecisionStateV1(
        nextState,
        input.decision.itemGraph,
        candidateGeneratorRulesFromSlotStateV1(nextSlots),
      );
      if (!step.projectedAfter || !sameProjection(after, step.projectedAfter)) {
        violations.push({
          stepId: step.stepId,
          code: 'PROJECTED_AFTER_MISMATCH',
          reasonCodes: candidate.reasons,
        });
      }
      state = nextState;
      slots = nextSlots;
      resolvedStepIds.add(step.stepId);
    }

    return { valid: violations.length === 0, violations };
  }
}

function matchingCandidate(
  step: AdaptivePlanStepV1,
  state: RecommendationDecisionState,
  slots: AdaptiveSlotStateV1,
  decision: AdaptiveDecisionStateV1,
): RecommendationCandidate | undefined {
  const planned = step.action;
  if (!planned) return undefined;
  const candidates = generateRecommendationCandidates({
    state,
    itemGraph: decision.itemGraph,
    rules: candidateGeneratorRulesFromSlotStateV1(slots, {
      allowSellOnlyActions: true,
      generateTargetedWaitActions: true,
    }),
  });
  return candidates.find((candidate) => {
    const action = candidate.action;
    if (planned.type === 'BUY') {
      return action.type === 'BUY_ITEM' && action.itemId === planned.buyItemId;
    }
    if (planned.type === 'UPGRADE') {
      return action.type === 'UPGRADE_ITEM' &&
        action.itemId === planned.buyItemId &&
        (planned.recipeId === undefined || action.recipeId === planned.recipeId) &&
        sameNumberSet(action.consumedItemIds, planned.consumedItemIds);
    }
    return action.type === 'REPLACE_ITEM' &&
      action.sellItemId === planned.sellItemId &&
      action.buyItemId === planned.buyItemId;
  });
}

function applyBarrier(
  step: AdaptivePlanStepV1,
  state: RecommendationDecisionState,
  slots: AdaptiveSlotStateV1,
  decision: AdaptiveDecisionStateV1,
): { state: RecommendationDecisionState; slots: AdaptiveSlotStateV1 } | undefined {
  const barrier = step.barrier;
  if (!barrier) return undefined;
  if (barrier.type === 'WAIT_FOR_GOLD') {
    return {
      state: {
        ...state,
        economy: {
          ...state.economy,
          spendableSouls: reconstructedFact(
            Math.max(barrier.requiredSouls, state.economy.spendableSouls.value ?? 0),
            'transaction-plan-validator:gold',
          ),
        },
      },
      slots,
    };
  }
  if (barrier.type === 'WAIT_FOR_SHOP') {
    return {
      state: {
        ...state,
        economy: {
          ...state.economy,
          shopOpportunity: reconstructedFact('AVAILABLE', 'transaction-plan-validator:shop'),
        },
      },
      slots,
    };
  }
  if (barrier.type === 'WAIT_FOR_FLEX') {
    if (barrier.requiredUnlockedFlexSlots > slots.maxFlexSlots) return undefined;
    const nextSlots = deriveAdaptiveSlotStateV1(
      [...state.inventory.heldByItemId.keys()],
      decision.itemGraph,
      {
        baseSlots: slots.baseSlots,
        baseSlotsByType: slots.baseSlotsByType,
        maxFlexSlots: slots.maxFlexSlots,
        maxActiveItems: slots.maxActiveItems,
      },
      { unlockedFlexSlots: barrier.requiredUnlockedFlexSlots, evidence: 'RECONSTRUCTED' },
    );
    return { state, slots: nextSlots };
  }
  if (barrier.type === 'WAIT_FOR_PREREQUISITE') {
    return { state, slots };
  }
  return undefined;
}

function sameProjection(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameNumberSet(a: readonly number[], b: readonly number[]): boolean {
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
