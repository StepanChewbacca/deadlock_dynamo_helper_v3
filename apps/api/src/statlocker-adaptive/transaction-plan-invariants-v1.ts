import {
  AdaptiveActionV1,
  AdaptivePlanProjectionV1,
  AdaptivePlanSessionV1,
  AdaptivePlanStepV1,
  AdaptivePlannedItemV1,
} from '@deadlock-live-probe/shared';
import { AdaptiveDecisionStateV1 } from './adaptive-decision-state-v1.service';

export type TransactionPlanInvariantViolationCodeV1 =
  | 'FUTURE_TARGET_WITHOUT_STEP'
  | 'PROJECTED_SLOT_VIOLATION'
  | 'REPLACE_WITHOUT_VALIDATED_BUY'
  | 'NEXT_STEP_MISMATCH'
  | 'NEXT_NOT_EXECUTABLE'
  | 'UNKNOWN_SLOT_PATH'
  | 'COMPATIBILITY_PROJECTION_DIVERGENCE';

export interface TransactionPlanInvariantViolationV1 {
  code: TransactionPlanInvariantViolationCodeV1;
  stepId?: string;
  itemId?: number;
  reasonCodes: readonly string[];
}

export interface TransactionPlanInvariantCheckV1 {
  valid: boolean;
  violations: readonly TransactionPlanInvariantViolationV1[];
}

export interface TransactionPlanInvariantSummaryV1 {
  evaluatedDecisions: number;
  futureTargetWithoutStepRate: number;
  projectedSlotViolationRate: number;
  replaceWithoutValidatedBuyRate: number;
  nextStepMismatchRate: number;
  nextNotExecutableRate: number;
  unknownSlotPathRate: number;
  compatibilityProjectionDivergenceRate: number;
}

export interface EvaluateTransactionPlanInvariantsV1Input {
  decision: AdaptiveDecisionStateV1;
  planSession: AdaptivePlanSessionV1;
  nextAction: AdaptiveActionV1;
  recommendedBuild: readonly AdaptivePlannedItemV1[];
}

export function evaluateTransactionPlanInvariantsV1(
  input: EvaluateTransactionPlanInvariantsV1Input,
): TransactionPlanInvariantCheckV1 {
  const violations: TransactionPlanInvariantViolationV1[] = [];
  const currentOwned = new Set(input.decision.state.inventory.heldByItemId.keys());
  const targetByStep = new Map<string, number>();
  const stepTargets = new Set<number>();

  for (const step of input.planSession.steps) {
    const targetItemId = planStepTargetItemId(step);
    if (targetItemId !== undefined) {
      targetByStep.set(step.stepId, targetItemId);
      stepTargets.add(targetItemId);
    }

    checkProjection(step.projectedBefore, step, violations);
    if (step.projectedAfter) checkProjection(step.projectedAfter, step, violations);

    if (step.action?.type === 'SELL_AND_BUY') {
      const after = step.projectedAfter;
      if (!after || !after.inventoryItemIds.includes(step.action.buyItemId) || after.inventoryItemIds.includes(step.action.sellItemId)) {
        violations.push({
          code: 'REPLACE_WITHOUT_VALIDATED_BUY',
          stepId: step.stepId,
          itemId: step.action.buyItemId,
          reasonCodes: ['REPLACEMENT_PROJECTION_DOES_NOT_PROVE_SELL_AND_BUY'],
        });
      }
    }
  }

  for (const row of input.recommendedBuild) {
    if (row.status === 'OWNED' || currentOwned.has(row.itemId)) continue;
    if (!stepTargets.has(row.itemId)) {
      violations.push({
        code: 'FUTURE_TARGET_WITHOUT_STEP',
        itemId: row.itemId,
        reasonCodes: ['COMPATIBILITY_FUTURE_ROW_HAS_NO_TRANSACTION_OR_BARRIER_STEP'],
      });
    }
  }

  checkNextAlignment(input, targetByStep, violations);
  checkCompatibilityProjection(input, targetByStep, violations);

  return {
    valid: violations.length === 0,
    violations: dedupeViolations(violations),
  };
}

export function summarizeTransactionPlanInvariantChecksV1(
  checks: readonly TransactionPlanInvariantCheckV1[],
): TransactionPlanInvariantSummaryV1 {
  const count = checks.length;
  const rate = (code: TransactionPlanInvariantViolationCodeV1): number => {
    if (count === 0) return 0;
    return checks.filter((check) => check.violations.some((violation) => violation.code === code)).length / count;
  };
  return {
    evaluatedDecisions: count,
    futureTargetWithoutStepRate: rate('FUTURE_TARGET_WITHOUT_STEP'),
    projectedSlotViolationRate: rate('PROJECTED_SLOT_VIOLATION'),
    replaceWithoutValidatedBuyRate: rate('REPLACE_WITHOUT_VALIDATED_BUY'),
    nextStepMismatchRate: rate('NEXT_STEP_MISMATCH'),
    nextNotExecutableRate: rate('NEXT_NOT_EXECUTABLE'),
    unknownSlotPathRate: rate('UNKNOWN_SLOT_PATH'),
    compatibilityProjectionDivergenceRate: rate('COMPATIBILITY_PROJECTION_DIVERGENCE'),
  };
}

function checkProjection(
  projection: AdaptivePlanProjectionV1,
  step: AdaptivePlanStepV1,
  violations: TransactionPlanInvariantViolationV1[],
): void {
  if (projection.flexUsed > 0 && projection.unlockedFlexSlots === undefined) {
    violations.push({
      code: 'UNKNOWN_SLOT_PATH',
      stepId: step.stepId,
      reasonCodes: ['PROJECTED_FLEX_USAGE_WITHOUT_PROVED_UNLOCK_CAPACITY'],
    });
    violations.push({
      code: 'PROJECTED_SLOT_VIOLATION',
      stepId: step.stepId,
      reasonCodes: ['PROJECTED_CAPACITY_CANNOT_BE_PROVED'],
    });
    return;
  }
  if (projection.unlockedFlexSlots !== undefined && projection.flexUsed > projection.unlockedFlexSlots) {
    violations.push({
      code: 'PROJECTED_SLOT_VIOLATION',
      stepId: step.stepId,
      reasonCodes: ['PROJECTED_FLEX_USAGE_EXCEEDS_UNLOCKED_CAPACITY'],
    });
  }
  if (projection.activeItemsUsed < 0 || projection.flexUsed < 0) {
    violations.push({
      code: 'PROJECTED_SLOT_VIOLATION',
      stepId: step.stepId,
      reasonCodes: ['NEGATIVE_PROJECTED_RESOURCE_USAGE'],
    });
  }
}

function checkNextAlignment(
  input: EvaluateTransactionPlanInvariantsV1Input,
  targetByStep: ReadonlyMap<string, number>,
  violations: TransactionPlanInvariantViolationV1[],
): void {
  const session = input.planSession;
  if (session.state === 'WAITING' || session.state === 'REPLAN_REQUIRED' || session.state === 'COMPLETE') {
    if (session.nextStepId !== undefined || isTransactionAction(input.nextAction)) {
      violations.push({
        code: 'NEXT_STEP_MISMATCH',
        stepId: session.nextStepId,
        itemId: input.nextAction.targetItemId,
        reasonCodes: ['NON_ACTIVE_SESSION_EXPOSES_EXECUTABLE_NEXT'],
      });
    }
    return;
  }

  if (!session.nextStepId) {
    violations.push({
      code: 'NEXT_STEP_MISMATCH',
      itemId: input.nextAction.targetItemId,
      reasonCodes: ['ACTIVE_SESSION_HAS_NO_NEXT_STEP_ID'],
    });
    return;
  }
  const nextStep = session.steps.find((step) => step.stepId === session.nextStepId);
  if (!nextStep || nextStep.kind !== 'TRANSACTION' || nextStep.state !== 'NEXT' || !nextStep.action) {
    violations.push({
      code: 'NEXT_STEP_MISMATCH',
      stepId: session.nextStepId,
      reasonCodes: ['NEXT_STEP_ID_DOES_NOT_REFERENCE_NEXT_TRANSACTION'],
    });
    return;
  }
  const stepTarget = targetByStep.get(nextStep.stepId);
  if (!isTransactionAction(input.nextAction) || input.nextAction.targetItemId !== stepTarget || !actionMatchesStep(input.nextAction, nextStep)) {
    violations.push({
      code: 'NEXT_STEP_MISMATCH',
      stepId: nextStep.stepId,
      itemId: input.nextAction.targetItemId,
      reasonCodes: ['NEXT_ACTION_DOES_NOT_MATCH_PLAN_SESSION_NEXT_STEP'],
    });
  }
}

function checkCompatibilityProjection(
  input: EvaluateTransactionPlanInvariantsV1Input,
  targetByStep: ReadonlyMap<string, number>,
  violations: TransactionPlanInvariantViolationV1[],
): void {
  const nextStepTarget = input.planSession.nextStepId
    ? targetByStep.get(input.planSession.nextStepId)
    : undefined;
  const flatNext = [...input.recommendedBuild]
    .sort((a, b) => a.position - b.position || a.itemId - b.itemId)
    .find((row) => row.status === 'NEXT')?.itemId;
  if (nextStepTarget !== flatNext) {
    if (nextStepTarget === undefined && flatNext === undefined) return;
    violations.push({
      code: 'COMPATIBILITY_PROJECTION_DIVERGENCE',
      itemId: flatNext ?? nextStepTarget,
      reasonCodes: ['FLAT_NEXT_ROW_DOES_NOT_MATCH_TRANSACTION_PLAN_NEXT'],
    });
  }
}

function actionMatchesStep(action: AdaptiveActionV1, step: AdaptivePlanStepV1): boolean {
  const planned = step.action;
  if (!planned) return false;
  if (planned.type === 'BUY') {
    return action.type === 'BUY' && (action.buyItemId ?? action.itemId) === planned.buyItemId;
  }
  if (planned.type === 'UPGRADE') {
    return action.type === 'UPGRADE' && (action.buyItemId ?? action.itemId) === planned.buyItemId;
  }
  return action.type === 'REPLACE' &&
    action.sellItemId === planned.sellItemId &&
    action.buyItemId === planned.buyItemId;
}

function planStepTargetItemId(step: AdaptivePlanStepV1): number | undefined {
  if (step.action) return step.action.buyItemId;
  if (step.barrier && 'targetItemId' in step.barrier) return step.barrier.targetItemId;
  return undefined;
}

function isTransactionAction(action: AdaptiveActionV1): boolean {
  return action.type === 'BUY' || action.type === 'UPGRADE' || action.type === 'SELL' || action.type === 'REPLACE';
}

function dedupeViolations(
  violations: readonly TransactionPlanInvariantViolationV1[],
): TransactionPlanInvariantViolationV1[] {
  const byKey = new Map<string, TransactionPlanInvariantViolationV1>();
  for (const violation of violations) {
    const key = `${violation.code}:${violation.stepId ?? ''}:${violation.itemId ?? ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, violation);
      continue;
    }
    byKey.set(key, {
      ...existing,
      reasonCodes: [...new Set([...existing.reasonCodes, ...violation.reasonCodes])].sort(),
    });
  }
  return [...byKey.values()].sort((a, b) =>
    a.code.localeCompare(b.code) ||
    (a.stepId ?? '').localeCompare(b.stepId ?? '') ||
    (a.itemId ?? 0) - (b.itemId ?? 0),
  );
}
