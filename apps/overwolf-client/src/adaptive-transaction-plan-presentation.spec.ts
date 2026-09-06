import { buildAdaptiveRecommendationPresentation } from './adaptive-recommendation-presentation';

function baseRecommendation(overrides: Record<string, unknown> = {}): any {
  return {
    ready: true,
    blockers: [],
    decisionId: 'd',
    stateRevision: 'r',
    gameState: 'EVEN',
    nextAction: { actionKey: 'HOLD', type: 'HOLD', reasonCodes: [] },
    recommendedBuild: [],
    changes: [],
    rankedImmediateCandidates: [],
    totalScore: 0,
    confidence: 0.8,
    scorerVersion: 'adaptive-evidence-scorer-v1',
    plannerVersion: 'adaptive-build-planner-v1',
    configVersion: 'test',
    plannerMethod: 'STRATEGY_FIRST',
    evidence: {
      rulesetVersion: 'r1', catalogSha256: 'a'.repeat(64), snapshotIds: [], families: [], degradedReasons: [],
    },
    ...overrides,
  };
}

const projection = {
  inventoryItemIds: [1437614329],
  spendableSouls: 5000,
  usedByType: { weapon: 1, vitality: 0, spirit: 0 },
  flexUsed: 0,
  unlockedFlexSlots: 1,
  activeItemsUsed: 0,
};

describe('adaptive transaction plan presentation', () => {
  it('renders SELL_AND_BUY from planSession and names the exact sold item', () => {
    const view = buildAdaptiveRecommendationPresentation(baseRecommendation({
      nextAction: {
        actionKey: 'REPLACE_ITEM:1437614329->3862866912',
        type: 'REPLACE',
        sellItemId: 1437614329,
        buyItemId: 3862866912,
        targetItemId: 3862866912,
        reasonCodes: [],
      },
      planSession: {
        planSessionId: 'p', strategyId: 's', revision: 1, createdAtGameTimeSec: 1, updatedAtGameTimeSec: 1,
        state: 'ACTIVE', nextStepId: 'replace', reasonCodes: [],
        steps: [{
          stepId: 'replace', goalId: 'g', kind: 'TRANSACTION', state: 'NEXT',
          action: { type: 'SELL_AND_BUY', sellItemId: 1437614329, buyItemId: 3862866912 },
          prerequisiteStepIds: [], blockingReasons: [], projectedBefore: projection,
          projectedAfter: { ...projection, inventoryItemIds: [3862866912], spendableSouls: 4600 },
          reasonCodes: [],
        }],
      },
      recommendedBuild: [{
        itemId: 3862866912, position: 1, status: 'NEXT', score: 0, confidence: 0, skeletonStrength: 0, contextualSupport: 0,
        reasonCodes: [],
      }],
    }));

    expect(view.plan.steps).toHaveLength(1);
    expect(view.plan.steps[0]).toMatchObject({
      stepId: 'replace',
      state: 'NEXT',
      stateLabel: 'Next',
      actionLabel: 'Replace',
      item: { name: 'Restorative Shot' },
      soldItem: { name: 'Melee Lifesteal' },
      detailLabel: 'Sell Melee Lifesteal before purchase',
    });
  });

  it('renders an upgrade as an explicit transaction rather than a generic planned item', () => {
    const view = buildAdaptiveRecommendationPresentation(baseRecommendation({
      planSession: {
        planSessionId: 'p', strategyId: 's', revision: 1, createdAtGameTimeSec: 1, updatedAtGameTimeSec: 1,
        state: 'ACTIVE', nextStepId: 'upgrade', reasonCodes: [],
        steps: [{
          stepId: 'upgrade', goalId: 'g', kind: 'TRANSACTION', state: 'NEXT',
          action: { type: 'UPGRADE', buyItemId: 3862866912, consumedItemIds: [1437614329], recipeId: 'r' },
          prerequisiteStepIds: [], blockingReasons: [], projectedBefore: projection,
          projectedAfter: { ...projection, inventoryItemIds: [3862866912] }, reasonCodes: [],
        }],
      },
    }));

    expect(view.plan.steps[0]).toMatchObject({ actionLabel: 'Upgrade', stateLabel: 'Next' });
    expect(view.plan.steps[0].detailLabel).toContain('Uses Melee Lifesteal');
  });

  it('renders WAIT_FOR_FLEX as a blocked barrier with the exact threshold', () => {
    const view = buildAdaptiveRecommendationPresentation(baseRecommendation({
      nextAction: { actionKey: 'HOLD', type: 'HOLD', targetItemId: 3862866912, reasonCodes: ['WAIT_FOR_FLEX'] },
      planSession: {
        planSessionId: 'p', strategyId: 's', revision: 1, createdAtGameTimeSec: 1, updatedAtGameTimeSec: 1,
        state: 'WAITING', reasonCodes: [],
        steps: [{
          stepId: 'flex', goalId: 'g', kind: 'BARRIER', state: 'BLOCKED',
          barrier: { type: 'WAIT_FOR_FLEX', targetItemId: 3862866912, requiredUnlockedFlexSlots: 2 },
          prerequisiteStepIds: [], blockingReasons: ['INSUFFICIENT_FLEX'],
          projectedBefore: { ...projection, unlockedFlexSlots: 1 }, reasonCodes: ['WAIT_FOR_FLEX'],
        }],
      },
    }));

    expect(view.plan.steps[0]).toMatchObject({
      state: 'BLOCKED',
      stateLabel: 'Blocked',
      actionLabel: 'Wait for Flex',
      item: { name: 'Restorative Shot' },
      detailLabel: 'Waiting for Flex · 1 / 2 unlocked',
    });
  });

  it('does not infer a sold item from the flat compatibility projection', () => {
    const view = buildAdaptiveRecommendationPresentation(baseRecommendation({
      recommendedBuild: [{
        itemId: 3862866912, position: 1, status: 'NEXT', score: 0, confidence: 0, skeletonStrength: 0, contextualSupport: 0,
        reasonCodes: ['SELL_SOMETHING'],
      }],
      planSession: {
        planSessionId: 'p', strategyId: 's', revision: 1, createdAtGameTimeSec: 1, updatedAtGameTimeSec: 1,
        state: 'WAITING', reasonCodes: [],
        steps: [{
          stepId: 'flex', goalId: 'g', kind: 'BARRIER', state: 'BLOCKED',
          barrier: { type: 'WAIT_FOR_FLEX', targetItemId: 3862866912, requiredUnlockedFlexSlots: 2 },
          prerequisiteStepIds: [], blockingReasons: ['INSUFFICIENT_FLEX'], projectedBefore: projection, reasonCodes: [],
        }],
      },
    }));

    expect(view.plan.steps[0].soldItem).toBeUndefined();
  });

  it('keeps an empty planSession authoritative over the flat compatibility projection', () => {
    const view = buildAdaptiveRecommendationPresentation(baseRecommendation({
      recommendedBuild: [{
        itemId: 3862866912, position: 1, status: 'NEXT', score: 0, confidence: 0, skeletonStrength: 0, contextualSupport: 0,
        reasonCodes: [],
      }],
      planSession: {
        planSessionId: 'p', strategyId: 's', revision: 1, createdAtGameTimeSec: 1, updatedAtGameTimeSec: 1,
        state: 'COMPLETE', reasonCodes: [], steps: [],
      },
    }));

    expect(view.plan.isTransactionPlan).toBe(true);
    expect(view.plan.steps).toEqual([]);
  });
});
