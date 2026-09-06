import { AdaptivePlannerServingRouterV1Service } from '../src/statlocker-adaptive/adaptive-planner-serving-router-v1.service';

function decision(economyRulesEvidence: string = 'RECONSTRUCTED'): any {
  return {
    state: { decisionId: 'd', heroId: 1, gameTimeSec: 100 },
    stateRevision: 'r',
    economyRulesEvidence,
  };
}

function transactionResult(): any {
  return {
    gameState: 'EVEN',
    nextAction: { actionKey: 'REPLACE_ITEM:1->2', type: 'REPLACE', sellItemId: 1, buyItemId: 2, targetItemId: 2, reasonCodes: [] },
    recommendedBuild: [{ itemId: 2, position: 1, status: 'NEXT', score: 0, confidence: 0, skeletonStrength: 0, contextualSupport: 0, reasonCodes: [] }],
    changes: [], rankedImmediateCandidates: [], totalScore: 1, confidence: 1, plannerVersion: 'adaptive-build-planner-v1',
    strategy: {
      strategyId: 's', commitment: 'COMMITTED', posterior: 1, reasonCodes: [], selectedBranches: {}, committedBranches: {},
      buildStatus: 'IN_PROGRESS', progress: { satisfiedHardGoals: 0, totalHardGoals: 1 }, remainingGoalIds: ['g'],
      slotPlan: { currentUsedSlots: 4, currentFlexUsed: 0, unlockedFlexSlots: 0, reservedSituationalSlots: 0, feasible: true, reasonCodes: [] },
      investmentObjectives: [],
    },
    planSession: {
      planSessionId: 'p', strategyId: 's', revision: 1, createdAtGameTimeSec: 100, updatedAtGameTimeSec: 100,
      state: 'ACTIVE', nextStepId: 'replace', reasonCodes: [], steps: [],
    },
  };
}

function flatResult(): any {
  return {
    ...transactionResult(),
    nextAction: { actionKey: 'SELL_ITEM:1', type: 'SELL', itemId: 1, sellItemId: 1, targetItemId: 2, reasonCodes: ['LEGACY_SLOT_EXIT'] },
    planSession: undefined,
  };
}

function legacyResult(): any {
  return {
    gameState: 'EVEN',
    nextAction: { actionKey: 'BUY:3', type: 'BUY', targetItemId: 3, reasonCodes: [] },
    recommendedBuild: [{ itemId: 3, position: 1, status: 'NEXT', score: 0, confidence: 0, skeletonStrength: 0, contextualSupport: 0, reasonCodes: [] }],
    changes: [], rankedImmediateCandidates: [], totalScore: 1, confidence: 1, plannerVersion: 'adaptive-build-planner-v1',
  };
}

function router(transactionMode: 'FLAT_COMPAT' | 'TRANSACTION_SHADOW' | 'TRANSACTION_PRIMARY', promotable: boolean) {
  const calls = { shadow: 0, blocked: 0 };
  const strategy = {
    plan: jest.fn(() => transactionResult()),
    planFlatCompat: jest.fn(() => flatResult()),
  } as any;
  const legacy = {
    plan: jest.fn(() => legacyResult()),
  } as any;
  const promotion = {
    configuredMode: () => 'STRATEGY',
    canServeStrategy: () => true,
    recordShadowSuccess: jest.fn(),
    recordShadowFailure: jest.fn(),
    recordPromotionBlocked: jest.fn(),
    transactionConfiguredMode: () => transactionMode,
    canServeTransactionPlan: () => promotable,
    transactionPromotionApproved: () => false,
    recordTransactionShadowSuccess: () => { calls.shadow += 1; },
    recordTransactionShadowFailure: jest.fn(),
    recordTransactionPromotionBlocked: () => { calls.blocked += 1; },
  } as any;
  const value = new AdaptivePlannerServingRouterV1Service(
    strategy,
    {} as any,
    {} as any,
    {} as any,
    promotion,
  );
  (value as any).legacy = legacy;
  return { value, calls, strategy, legacy };
}

describe('transaction plan serving shadow v1', () => {
  it('computes transaction plan in TRANSACTION_SHADOW but serves flat strategy output', () => {
    const { value, calls, strategy } = router('TRANSACTION_SHADOW', false);
    const result = value.plan({ decision: decision() } as any);
    expect(strategy.plan).toHaveBeenCalledTimes(1);
    expect(strategy.planFlatCompat).toHaveBeenCalledTimes(1);
    expect(result.nextAction.type).toBe('SELL');
    expect(result.planSession).toBeUndefined();
    expect(calls.shadow).toBe(1);
  });

  it('serves transaction output only when TRANSACTION_PRIMARY is promotable', () => {
    const { value, strategy } = router('TRANSACTION_PRIMARY', true);
    const result = value.plan({ decision: decision() } as any);
    expect(result.nextAction.type).toBe('REPLACE');
    expect(result.planSession?.planSessionId).toBe('p');
    expect(strategy.planFlatCompat).not.toHaveBeenCalled();
  });

  it('blocks configured TRANSACTION_PRIMARY when hard transaction gates are not promotable', () => {
    const { value, calls } = router('TRANSACTION_PRIMARY', false);
    const result = value.plan({ decision: decision() } as any);
    expect(result.nextAction.type).toBe('SELL');
    expect(calls.blocked).toBe(1);
    expect(calls.shadow).toBe(1);
  });

  it('falls back to flat compat when primary is configured but validation failure blocks promotion', () => {
    const { value, strategy } = router('TRANSACTION_PRIMARY', false);

    const result = value.plan({ decision: decision() } as any);

    expect(result.nextAction.type).toBe('SELL');
    expect(result.planSession).toBeUndefined();
    expect(strategy.planFlatCompat).toHaveBeenCalledTimes(1);
  });

  it('falls back to legacy when exact economy evidence is unavailable', () => {
    const { value, strategy, legacy } = router('TRANSACTION_PRIMARY', true);

    const result = value.plan({ decision: decision('UNKNOWN') } as any);

    expect(result.nextAction.type).toBe('BUY');
    expect(legacy.plan).toHaveBeenCalledTimes(1);
    expect(strategy.planFlatCompat).not.toHaveBeenCalled();
  });
});
