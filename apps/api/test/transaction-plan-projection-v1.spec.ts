import { AdaptivePlanSessionV1 } from '@deadlock-live-probe/shared';
import {
  nextActionFromPlanSessionV1,
  recommendedBuildFromPlanSessionV1,
} from '../src/statlocker-adaptive/transaction-plan-projection-v1';

const projection = {
  inventoryItemIds: [] as number[], spendableSouls: 5000,
  usedByType: { weapon: 0, vitality: 0, spirit: 0 }, flexUsed: 0, unlockedFlexSlots: 0, activeItemsUsed: 0,
};

function session(step: AdaptivePlanSessionV1['steps'][number], state: AdaptivePlanSessionV1['state'] = 'ACTIVE'): AdaptivePlanSessionV1 {
  return {
    planSessionId: 'p', strategyId: 's', revision: 1, createdAtGameTimeSec: 100, updatedAtGameTimeSec: 100,
    state, steps: [step], nextStepId: step.state === 'NEXT' ? step.stepId : undefined, reasonCodes: [],
  };
}

describe('transaction plan projection v1', () => {
  it('maps BUY to AdaptiveAction BUY', () => {
    const value = session({
      stepId: 'buy', goalId: 'g', kind: 'TRANSACTION', state: 'NEXT', action: { type: 'BUY', buyItemId: 2 },
      prerequisiteStepIds: [], blockingReasons: [], projectedBefore: projection, reasonCodes: ['CORE'],
    });
    expect(nextActionFromPlanSessionV1(value)).toMatchObject({ type: 'BUY', itemId: 2, buyItemId: 2, targetItemId: 2 });
  });

  it('maps UPGRADE to AdaptiveAction UPGRADE', () => {
    const value = session({
      stepId: 'upgrade', goalId: 'g', kind: 'TRANSACTION', state: 'NEXT',
      action: { type: 'UPGRADE', buyItemId: 3, consumedItemIds: [1], recipeId: 'r' },
      prerequisiteStepIds: [], blockingReasons: [], projectedBefore: projection, reasonCodes: [],
    });
    expect(nextActionFromPlanSessionV1(value)).toMatchObject({ type: 'UPGRADE', itemId: 3, buyItemId: 3, targetItemId: 3 });
  });

  it('maps SELL_AND_BUY to AdaptiveAction REPLACE with both ids', () => {
    const value = session({
      stepId: 'replace', goalId: 'g', kind: 'TRANSACTION', state: 'NEXT',
      action: { type: 'SELL_AND_BUY', sellItemId: 1, buyItemId: 4 },
      prerequisiteStepIds: [], blockingReasons: [], projectedBefore: projection, reasonCodes: [],
    });
    expect(nextActionFromPlanSessionV1(value)).toMatchObject({ type: 'REPLACE', sellItemId: 1, buyItemId: 4, targetItemId: 4 });
  });

  it('maps a leading barrier to HOLD and never exposes it as NEXT', () => {
    const value: AdaptivePlanSessionV1 = {
      planSessionId: 'p', strategyId: 's', revision: 1, createdAtGameTimeSec: 100, updatedAtGameTimeSec: 100,
      state: 'WAITING', nextStepId: undefined, reasonCodes: ['WAITING_ON_PLAN_BARRIER'],
      steps: [
        {
          stepId: 'flex', goalId: 'g', kind: 'BARRIER', state: 'BLOCKED',
          barrier: { type: 'WAIT_FOR_FLEX', targetItemId: 4, requiredUnlockedFlexSlots: 2 },
          prerequisiteStepIds: [], blockingReasons: ['INSUFFICIENT_FLEX'], projectedBefore: projection, reasonCodes: ['WAIT_FOR_FLEX'],
        },
        {
          stepId: 'buy', goalId: 'g', kind: 'TRANSACTION', state: 'LOCKED', action: { type: 'BUY', buyItemId: 4 },
          prerequisiteStepIds: ['flex'], blockingReasons: [], projectedBefore: projection, reasonCodes: [],
        },
      ],
    };
    expect(nextActionFromPlanSessionV1(value)).toMatchObject({ type: 'HOLD', targetItemId: 4 });
    expect(nextActionFromPlanSessionV1(value).reasonCodes).toContain('WAIT_FOR_FLEX');
  });

  it('builds legacy rows only as a one-way projection of structured plan steps', () => {
    const value = session({
      stepId: 'replace', goalId: 'g', kind: 'TRANSACTION', state: 'NEXT',
      action: { type: 'SELL_AND_BUY', sellItemId: 1, buyItemId: 4 },
      prerequisiteStepIds: [], blockingReasons: [], projectedBefore: projection, reasonCodes: ['SLOT_REPLACEMENT'],
    });
    const rows = recommendedBuildFromPlanSessionV1({ session: value, ownedItemIds: [1, 2] });
    expect(rows.map((row) => [row.itemId, row.status])).toEqual([[1, 'OWNED'], [2, 'OWNED'], [4, 'NEXT']]);
    expect(rows.find((row) => row.itemId === 4)?.reasonCodes).toContain('TRANSACTION_STEP:replace');
  });

  it('returns HOLD for a replan-required session', () => {
    const value: AdaptivePlanSessionV1 = {
      planSessionId: 'p', strategyId: 's', revision: 1, createdAtGameTimeSec: 100, updatedAtGameTimeSec: 100,
      state: 'REPLAN_REQUIRED', steps: [], reasonCodes: ['TRANSACTION_PATH_UNREACHABLE'],
    };
    expect(nextActionFromPlanSessionV1(value)).toMatchObject({ type: 'HOLD' });
    expect(nextActionFromPlanSessionV1(value).reasonCodes).toContain('REPLAN_REQUIRED');
  });
});
