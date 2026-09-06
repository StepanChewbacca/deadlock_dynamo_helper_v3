import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AdaptivePlanSessionV1, AdaptivePlanStepV1 } from '@deadlock-live-probe/shared';
import { AdaptiveDecisionStateV1 } from './adaptive-decision-state-v1.service';
import {
  isPlanBarrierSatisfiedV1,
  isTransactionStepSatisfiedV1,
} from './transaction-plan-step-v1';

export interface ReconcileTransactionPlanV1Input {
  previous?: AdaptivePlanSessionV1;
  strategyId: string;
  gameTimeSec: number;
  proposedSteps: readonly AdaptivePlanStepV1[];
  proposedReachable?: boolean;
  decision: AdaptiveDecisionStateV1;
}

@Injectable()
export class TransactionPlanReconcilerV1Service {
  reconcile(input: ReconcileTransactionPlanV1Input): AdaptivePlanSessionV1 {
    const sameStrategy = input.previous?.strategyId === input.strategyId;
    const planSessionId = sameStrategy && input.previous
      ? input.previous.planSessionId
      : createPlanSessionId(input);
    const createdAtGameTimeSec = sameStrategy && input.previous
      ? input.previous.createdAtGameTimeSec
      : input.gameTimeSec;

    const proposedIds = new Set(input.proposedSteps.map((step) => step.stepId));
    const historical: AdaptivePlanStepV1[] = [];
    if (sameStrategy && input.previous) {
      for (const previousStep of input.previous.steps) {
        if (proposedIds.has(previousStep.stepId)) continue;
        if (previousStep.state === 'COMPLETED' || previousStep.state === 'SKIPPED') {
          historical.push(previousStep);
          continue;
        }
        if (previousStep.kind === 'TRANSACTION' &&
          isTransactionStepSatisfiedV1(previousStep, input.decision.state, input.decision.itemGraph)) {
          historical.push({ ...previousStep, state: 'COMPLETED', blockingReasons: [] });
          continue;
        }
        if (previousStep.kind === 'BARRIER' && previousStep.barrier &&
          isPlanBarrierSatisfiedV1(previousStep.barrier, input.decision.state, input.decision.slots.unlockedFlexSlots)) {
          historical.push({ ...previousStep, state: 'COMPLETED', blockingReasons: [] });
        }
      }
    }

    const proposed = input.proposedSteps.map((step) => this.resolveCompletion(step, input.decision));
    const deduped = dedupeSteps([...historical, ...proposed]);
    const normalized = assignRuntimeStates(deduped, input.proposedReachable !== false);
    const state = input.proposedReachable === false
      ? 'REPLAN_REQUIRED' as const
      : normalized.state;
    const nextStepId = state === 'ACTIVE' ? normalized.nextStepId : undefined;
    const reasonCodes = unique([
      ...(state === 'REPLAN_REQUIRED' ? ['TRANSACTION_PATH_UNREACHABLE'] : []),
      ...(state === 'WAITING' ? ['WAITING_ON_PLAN_BARRIER'] : []),
      ...(state === 'COMPLETE' ? ['TRANSACTION_PLAN_COMPLETE'] : []),
      ...(sameStrategy ? ['PLAN_SESSION_RECONCILED'] : ['PLAN_SESSION_CREATED']),
    ]);

    const withoutRevision: Omit<AdaptivePlanSessionV1, 'revision'> = {
      planSessionId,
      strategyId: input.strategyId,
      createdAtGameTimeSec,
      updatedAtGameTimeSec: input.gameTimeSec,
      state,
      steps: normalized.steps,
      nextStepId,
      reasonCodes,
    };
    const revision = sameStrategy && input.previous
      ? input.previous.revision + (semanticSessionChanged(input.previous, withoutRevision) ? 1 : 0)
      : 1;
    return { ...withoutRevision, revision };
  }

  private resolveCompletion(step: AdaptivePlanStepV1, decision: AdaptiveDecisionStateV1): AdaptivePlanStepV1 {
    if (step.kind === 'TRANSACTION' &&
      isTransactionStepSatisfiedV1(step, decision.state, decision.itemGraph)) {
      return { ...step, state: 'COMPLETED', blockingReasons: [] };
    }
    if (step.kind === 'BARRIER' && step.barrier &&
      isPlanBarrierSatisfiedV1(step.barrier, decision.state, decision.slots.unlockedFlexSlots)) {
      return { ...step, state: 'COMPLETED', blockingReasons: [] };
    }
    return step;
  }
}

function assignRuntimeStates(
  steps: readonly AdaptivePlanStepV1[],
  reachable: boolean,
): { steps: readonly AdaptivePlanStepV1[]; state: AdaptivePlanSessionV1['state']; nextStepId?: string } {
  if (!reachable) {
    return {
      steps: steps.map((step) =>
        step.state === 'COMPLETED' || step.state === 'SKIPPED'
          ? step
          : { ...step, state: step.kind === 'BARRIER' ? 'BLOCKED' as const : 'LOCKED' as const },
      ),
      state: 'REPLAN_REQUIRED',
    };
  }

  let foundUnresolved = false;
  let waiting = false;
  let nextStepId: string | undefined;
  const normalized = steps.map((step): AdaptivePlanStepV1 => {
    if (step.state === 'COMPLETED' || step.state === 'SKIPPED' || step.state === 'INVALIDATED') return step;
    if (!foundUnresolved) {
      foundUnresolved = true;
      if (step.kind === 'BARRIER') {
        waiting = true;
        return { ...step, state: 'BLOCKED' };
      }
      nextStepId = step.stepId;
      return { ...step, state: 'NEXT' };
    }
    return { ...step, state: 'LOCKED' };
  });

  if (!foundUnresolved) return { steps: normalized, state: 'COMPLETE' };
  if (waiting) return { steps: normalized, state: 'WAITING' };
  return { steps: normalized, state: 'ACTIVE', nextStepId };
}

function dedupeSteps(steps: readonly AdaptivePlanStepV1[]): AdaptivePlanStepV1[] {
  const seen = new Set<string>();
  const result: AdaptivePlanStepV1[] = [];
  for (const step of steps) {
    if (seen.has(step.stepId)) continue;
    seen.add(step.stepId);
    result.push(step);
  }
  return result;
}

function createPlanSessionId(input: ReconcileTransactionPlanV1Input): string {
  const identity = [
    input.strategyId,
    input.decision.state.matchId,
    input.decision.state.playerSlot,
    input.gameTimeSec,
  ].join(':');
  return `plan:${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function semanticSessionChanged(
  previous: AdaptivePlanSessionV1,
  current: Omit<AdaptivePlanSessionV1, 'revision'>,
): boolean {
  if (previous.state !== current.state || previous.nextStepId !== current.nextStepId) return true;
  const previousSemantic = previous.steps.map(semanticStep);
  const currentSemantic = current.steps.map(semanticStep);
  return JSON.stringify(previousSemantic) !== JSON.stringify(currentSemantic);
}

function semanticStep(step: AdaptivePlanStepV1): unknown {
  return {
    stepId: step.stepId,
    goalId: step.goalId,
    kind: step.kind,
    state: step.state,
    action: step.action,
    barrier: step.barrier,
    prerequisiteStepIds: [...step.prerequisiteStepIds],
    blockingReasons: [...step.blockingReasons],
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
