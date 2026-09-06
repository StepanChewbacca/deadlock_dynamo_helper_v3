import { AdaptivePlanSessionV1 } from '@deadlock-live-probe/shared';
import { AdaptiveRecommendationObservabilityV1Service } from '../src/statlocker-adaptive/adaptive-recommendation-observability-v1.service';
import { StrategyFirstPromotionGateV1Service } from '../src/statlocker-adaptive/strategy-first-promotion-gate-v1.service';
import { diffTransactionPlansV1 } from '../src/statlocker-adaptive/transaction-plan-diff-v1';

const originalMode = process.env.ADAPTIVE_TRANSACTION_PLAN_MODE;
const originalApproval = process.env.ADAPTIVE_TRANSACTION_PLAN_PROMOTION_APPROVED;

function plan(): AdaptivePlanSessionV1 {
  return {
    planSessionId: 'plan',
    strategyId: 'strategy',
    revision: 1,
    createdAtGameTimeSec: 100,
    updatedAtGameTimeSec: 100,
    state: 'ACTIVE',
    nextStepId: 'buy',
    reasonCodes: [],
    steps: [{
      stepId: 'buy',
      goalId: 'g',
      kind: 'TRANSACTION',
      state: 'NEXT',
      action: { type: 'BUY', buyItemId: 2 },
      prerequisiteStepIds: [],
      blockingReasons: [],
      projectedBefore: {
        inventoryItemIds: [],
        spendableSouls: 0,
        usedByType: { weapon: 0, vitality: 0, spirit: 0 },
        flexUsed: 0,
        unlockedFlexSlots: 0,
        activeItemsUsed: 0,
      },
      projectedAfter: {
        inventoryItemIds: [2],
        spendableSouls: 0,
        usedByType: { weapon: 1, vitality: 0, spirit: 0 },
        flexUsed: 0,
        unlockedFlexSlots: 0,
        activeItemsUsed: 0,
      },
      reasonCodes: [],
    }],
  };
}

describe('transaction plan promotion gate v1', () => {
  afterEach(() => {
    if (originalMode === undefined) delete process.env.ADAPTIVE_TRANSACTION_PLAN_MODE;
    else process.env.ADAPTIVE_TRANSACTION_PLAN_MODE = originalMode;
    if (originalApproval === undefined) delete process.env.ADAPTIVE_TRANSACTION_PLAN_PROMOTION_APPROVED;
    else process.env.ADAPTIVE_TRANSACTION_PLAN_PROMOTION_APPROVED = originalApproval;
  });

  it('keeps TRANSACTION_PRIMARY blocked after any transaction validator failure', () => {
    process.env.ADAPTIVE_TRANSACTION_PLAN_MODE = 'TRANSACTION_PRIMARY';
    process.env.ADAPTIVE_TRANSACTION_PLAN_PROMOTION_APPROVED = 'true';
    const observability = new AdaptiveRecommendationObservabilityV1Service();
    const current = plan();
    observability.recordTransactionPlanOutcome({
      current,
      changes: diffTransactionPlansV1(undefined, current),
      validation: {
        valid: false,
        violations: [{ code: 'TRANSACTION_NOT_EXECUTABLE', reasonCodes: ['UNAFFORDABLE'] }],
      },
    });

    const status = new StrategyFirstPromotionGateV1Service(observability).transactionStatus();

    expect(status.promotable).toBe(false);
    expect(status.effectiveMode).toBe('TRANSACTION_SHADOW');
    expect(status.blockers).toContain('TRANSACTION_PLAN_VALIDATION_FAILURE');
  });
});
