import { AdaptivePlanSessionV1 } from '@deadlock-live-probe/shared';
import { AdaptiveRecommendationObservabilityV1Service } from '../src/statlocker-adaptive/adaptive-recommendation-observability-v1.service';
import { diffTransactionPlansV1 } from '../src/statlocker-adaptive/transaction-plan-diff-v1';
import { TransactionPlanInvariantCheckV1 } from '../src/statlocker-adaptive/transaction-plan-invariants-v1';

function check(code?: TransactionPlanInvariantCheckV1['violations'][number]['code']): TransactionPlanInvariantCheckV1 {
  return code
    ? { valid: false, violations: [{ code, reasonCodes: [`TEST:${code}`] }] }
    : { valid: true, violations: [] };
}

function session(revision: number, states: readonly ['one' | 'two', 'COMPLETED' | 'NEXT' | 'LOCKED'][]): AdaptivePlanSessionV1 {
  return {
    planSessionId: 'plan:s',
    strategyId: 's',
    revision,
    createdAtGameTimeSec: 100,
    updatedAtGameTimeSec: 101,
    state: 'ACTIVE',
    nextStepId: states.find(([, state]) => state === 'NEXT')?.[0],
    reasonCodes: [],
    steps: states.map(([stepId, state], index) => ({
      stepId,
      goalId: `g${index}`,
      kind: 'TRANSACTION' as const,
      state,
      action: index === 0
        ? { type: 'SELL_AND_BUY' as const, sellItemId: 10, buyItemId: 20 }
        : { type: 'BUY' as const, buyItemId: 30 },
      prerequisiteStepIds: index === 0 ? [] : ['one'],
      blockingReasons: [],
      projectedBefore: {
        inventoryItemIds: index === 0 ? [10] : [20],
        spendableSouls: 5000,
        usedByType: { weapon: 1, vitality: 0, spirit: 0 },
        flexUsed: 0,
        unlockedFlexSlots: 0,
        activeItemsUsed: 0,
      },
      projectedAfter: {
        inventoryItemIds: index === 0 ? [20] : [20, 30],
        spendableSouls: 4000,
        usedByType: { weapon: index === 0 ? 1 : 2, vitality: 0, spirit: 0 },
        flexUsed: 0,
        unlockedFlexSlots: 0,
        activeItemsUsed: 0,
      },
      reasonCodes: [],
    })),
  };
}

describe('transaction plan observability v1', () => {
  it('tracks transaction zero-tolerance rates by evaluated decision', () => {
    const service = new AdaptiveRecommendationObservabilityV1Service();
    service.recordTransactionPlanInvariantCheck(check());
    service.recordTransactionPlanInvariantCheck(check('NEXT_STEP_MISMATCH'));
    const status = service.getStatus();
    expect(status.transactionPlanRelease.evaluatedDecisions).toBe(2);
    expect(status.transactionPlanRelease.nextStepMismatchRate).toBe(0.5);
    expect(status.transactionPlanRelease.futureTargetWithoutStepRate).toBe(0);
  });

  it('records transaction invariant reason codes', () => {
    const service = new AdaptiveRecommendationObservabilityV1Service();
    service.recordTransactionPlanInvariantCheck(check('UNKNOWN_SLOT_PATH'));
    const status = service.getStatus();
    expect(status.reasonCodeCounts['TRANSACTION_PLAN_INVARIANT:UNKNOWN_SLOT_PATH']).toBe(1);
  });

  it('records stable prefix, step changes, replacement pairs, projections, and validator result', () => {
    const previous = session(1, [['one', 'NEXT'], ['two', 'LOCKED']]);
    const current = session(2, [['one', 'COMPLETED'], ['two', 'NEXT']]);
    const changes = diffTransactionPlansV1(previous, current);
    const service = new AdaptiveRecommendationObservabilityV1Service();

    service.recordTransactionPlanOutcome({
      previous,
      current,
      changes,
      validation: { valid: true, violations: [] },
    });

    const status = service.getStatus();
    expect(status.counters.transactionPlanDecisionCount).toBe(1);
    expect(status.counters.transactionPlanCompletedStepCount).toBe(1);
    expect(status.counters.transactionPlanReplacementPairCount).toBe(1);
    expect(status.latestTransactionPlan).toMatchObject({
      planSessionId: 'plan:s',
      revision: 2,
      preservedPrefixLength: 2,
      completedStepCount: 1,
      replacementPairCount: 1,
      validatorValid: true,
      validatorViolationCodes: [],
      projectedSlotBefore: { flexUsed: 0, unlockedFlexSlots: 0, activeItemsUsed: 0 },
      projectedSlotAfter: { flexUsed: 0, unlockedFlexSlots: 0, activeItemsUsed: 0 },
    });
  });

  it('counts validation failures and exposes their codes', () => {
    const current = session(1, [['one', 'NEXT'], ['two', 'LOCKED']]);
    const service = new AdaptiveRecommendationObservabilityV1Service();
    service.recordTransactionPlanOutcome({
      current,
      changes: diffTransactionPlansV1(undefined, current),
      validation: {
        valid: false,
        violations: [{ code: 'TRANSACTION_NOT_EXECUTABLE', reasonCodes: ['UNAFFORDABLE'] }],
      },
    });

    const status = service.getStatus();
    expect(status.counters.transactionPlanValidationFailureCount).toBe(1);
    expect(status.latestTransactionPlan?.validatorValid).toBe(false);
    expect(status.latestTransactionPlan?.validatorViolationCodes).toContain('TRANSACTION_NOT_EXECUTABLE');
  });
});
