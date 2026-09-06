import { AdaptivePlanSessionV1, AdaptivePlanStepV1 } from '@deadlock-live-probe/shared';

export type TransactionPlanChangeTypeV1 =
  | 'KEEP_STEP'
  | 'COMPLETE_STEP'
  | 'INSERT_STEP'
  | 'INVALIDATE_STEP'
  | 'REPLACE_STEP'
  | 'BLOCK_STEP'
  | 'UNBLOCK_STEP';

export interface TransactionPlanChangeV1 {
  type: TransactionPlanChangeTypeV1;
  stepId: string;
  replacementStepId?: string;
}

export function diffTransactionPlansV1(
  previous: AdaptivePlanSessionV1 | undefined,
  current: AdaptivePlanSessionV1,
): readonly TransactionPlanChangeV1[] {
  if (!previous || previous.strategyId !== current.strategyId) {
    return current.steps.map((step) => ({ type: 'INSERT_STEP' as const, stepId: step.stepId }));
  }

  const previousById = new Map(previous.steps.map((step) => [step.stepId, step]));
  const currentById = new Map(current.steps.map((step) => [step.stepId, step]));
  const changes: TransactionPlanChangeV1[] = [];

  for (const step of current.steps) {
    const before = previousById.get(step.stepId);
    if (!before) continue;
    const change = statusChange(before, step);
    changes.push(change ?? { type: 'KEEP_STEP', stepId: step.stepId });
  }

  const removed = previous.steps.filter((step) => !currentById.has(step.stepId));
  const inserted = current.steps.filter((step) => !previousById.has(step.stepId));
  const pairedInserted = new Set<string>();

  for (const removedStep of removed) {
    const replacement = inserted.find((candidate) =>
      !pairedInserted.has(candidate.stepId) && candidate.goalId === removedStep.goalId,
    );
    if (replacement) {
      pairedInserted.add(replacement.stepId);
      changes.push({
        type: 'REPLACE_STEP',
        stepId: removedStep.stepId,
        replacementStepId: replacement.stepId,
      });
    } else {
      changes.push({ type: 'INVALIDATE_STEP', stepId: removedStep.stepId });
    }
  }

  for (const insertedStep of inserted) {
    if (pairedInserted.has(insertedStep.stepId)) continue;
    changes.push({ type: 'INSERT_STEP', stepId: insertedStep.stepId });
  }

  return changes;
}

function statusChange(
  previous: AdaptivePlanStepV1,
  current: AdaptivePlanStepV1,
): TransactionPlanChangeV1 | undefined {
  if (previous.state !== 'COMPLETED' && current.state === 'COMPLETED') {
    return { type: 'COMPLETE_STEP', stepId: current.stepId };
  }
  if (previous.state !== 'BLOCKED' && current.state === 'BLOCKED') {
    return { type: 'BLOCK_STEP', stepId: current.stepId };
  }
  if (previous.state === 'BLOCKED' && current.state !== 'BLOCKED') {
    return { type: 'UNBLOCK_STEP', stepId: current.stepId };
  }
  if (current.state === 'INVALIDATED' && previous.state !== 'INVALIDATED') {
    return { type: 'INVALIDATE_STEP', stepId: current.stepId };
  }
  return undefined;
}
