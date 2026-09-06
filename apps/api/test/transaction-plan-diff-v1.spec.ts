import { AdaptivePlanSessionV1, AdaptivePlanStepV1 } from '@deadlock-live-probe/shared';
import { diffTransactionPlansV1 } from '../src/statlocker-adaptive/transaction-plan-diff-v1';

const projection = {
  inventoryItemIds: [] as number[], spendableSouls: 1000,
  usedByType: { weapon: 0, vitality: 0, spirit: 0 }, flexUsed: 0, unlockedFlexSlots: 0, activeItemsUsed: 0,
};

function step(stepId: string, state: AdaptivePlanStepV1['state'], itemId: number): AdaptivePlanStepV1 {
  return {
    stepId, goalId: `goal:${stepId}`, kind: 'TRANSACTION', state,
    action: { type: 'BUY', buyItemId: itemId }, prerequisiteStepIds: [], blockingReasons: [], projectedBefore: projection, reasonCodes: [],
  };
}

function session(steps: readonly AdaptivePlanStepV1[]): AdaptivePlanSessionV1 {
  return {
    planSessionId: 'p', strategyId: 's', revision: 1, createdAtGameTimeSec: 1, updatedAtGameTimeSec: 1,
    state: 'ACTIVE', steps, nextStepId: steps.find((entry) => entry.state === 'NEXT')?.stepId, reasonCodes: [],
  };
}

describe('transaction plan diff v1', () => {
  it('classifies NEXT to COMPLETED as COMPLETE_STEP instead of delete/insert churn', () => {
    const previous = session([step('a', 'NEXT', 1), step('b', 'LOCKED', 2)]);
    const current = session([step('a', 'COMPLETED', 1), step('b', 'NEXT', 2)]);
    const changes = diffTransactionPlansV1(previous, current);
    expect(changes).toContainEqual({ type: 'COMPLETE_STEP', stepId: 'a' });
    expect(changes.some((change) => change.type === 'INSERT_STEP' && change.stepId === 'a')).toBe(false);
  });

  it('keeps an unchanged prefix and only changes the suffix', () => {
    const previous = session([step('a', 'COMPLETED', 1), step('b', 'NEXT', 2), step('c', 'LOCKED', 3)]);
    const current = session([step('a', 'COMPLETED', 1), step('b', 'NEXT', 2), step('d', 'LOCKED', 4)]);
    const changes = diffTransactionPlansV1(previous, current);
    expect(changes).toContainEqual({ type: 'KEEP_STEP', stepId: 'a' });
    expect(changes).toContainEqual({ type: 'KEEP_STEP', stepId: 'b' });
    expect(changes).toContainEqual({ type: 'REPLACE_STEP', stepId: 'c', replacementStepId: 'd' });
  });

  it('classifies barrier blocking and unblocking without recreating the step', () => {
    const barrier: AdaptivePlanStepV1 = {
      stepId: 'flex', goalId: 'g', kind: 'BARRIER', state: 'BLOCKED',
      barrier: { type: 'WAIT_FOR_FLEX', targetItemId: 5, requiredUnlockedFlexSlots: 1 },
      prerequisiteStepIds: [], blockingReasons: ['INSUFFICIENT_FLEX'], projectedBefore: projection, reasonCodes: [],
    };
    const previous = session([{ ...barrier, state: 'READY' }]);
    const current = session([barrier]);
    expect(diffTransactionPlansV1(previous, current)).toContainEqual({ type: 'BLOCK_STEP', stepId: 'flex' });
    expect(diffTransactionPlansV1(current, previous)).toContainEqual({ type: 'UNBLOCK_STEP', stepId: 'flex' });
  });
});
