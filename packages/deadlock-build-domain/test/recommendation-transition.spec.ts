import {
  applyRecommendationCandidateTransitionV1,
  createRecommendationItemGraph,
  generateRecommendationCandidates,
  observedFact,
  RecommendationCandidate,
} from '../src';

const rules = {
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
  maxFlexSlots: 4,
  unlockedFlexSlots: 4,
  flexCapacityEvidence: 'OBSERVED' as const,
  maxActiveItems: 4,
  allowSellOnlyActions: true,
  generateTargetedWaitActions: true,
};

function graph() {
  return createRecommendationItemGraph([
    {
      itemId: 1,
      name: 'Component',
      slotType: 'weapon',
      active: false,
      availableRulesetIds: ['r1'],
      directPurchaseCost: 800,
      upgradeRecipes: [],
      sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    },
    {
      itemId: 2,
      name: 'Upgrade',
      slotType: 'weapon',
      active: false,
      availableRulesetIds: ['r1'],
      directPurchaseCost: 2400,
      upgradeRecipes: [{ recipeId: 'upgrade:2', consumedItemIds: [1], soulsCost: 1600 }],
      sellTransition: { soulsRefund: 1200, returnedItemIds: [1] },
    },
    {
      itemId: 3,
      name: 'Other',
      slotType: 'vitality',
      active: false,
      availableRulesetIds: ['r1'],
      directPurchaseCost: 1200,
      upgradeRecipes: [],
      sellTransition: { soulsRefund: 600, returnedItemIds: [] },
    },
  ]);
}

function state(itemIds: readonly number[], souls = 5000) {
  return {
    decisionId: 'd1',
    matchId: 'm1',
    playerSlot: 0,
    gameTimeSec: 100,
    rulesetId: 'r1',
    heroId: 1,
    inventory: {
      initializedFromSnapshot: true,
      heldByItemId: new Map(itemIds.map((itemId, index) => [itemId, {
        itemId,
        instanceId: `${itemId}:1`,
        lifecycle: 1,
        acquiredBy: 'RECONCILE' as const,
        acquiredAtMs: index,
      }])),
      lifecycleCountByItemId: new Map(itemIds.map((itemId) => [itemId, 1])),
      nextInstanceSequence: itemIds.length + 1,
    },
    economy: {
      spendableSouls: observedFact(souls, 'test'),
      shopOpportunity: observedFact('AVAILABLE' as const, 'test'),
    },
  };
}

function candidate(
  candidates: readonly RecommendationCandidate[],
  predicate: (candidate: RecommendationCandidate) => boolean,
): RecommendationCandidate {
  const value = candidates.find(predicate);
  if (!value) throw new Error('Expected candidate was not generated');
  return value;
}

describe('applyRecommendationCandidateTransitionV1', () => {
  it('applies BUY with exact inventory and wallet delta', () => {
    const itemGraph = graph();
    const current = state([]);
    const candidates = generateRecommendationCandidates({ state: current, itemGraph, rules });
    const buy = candidate(candidates, (entry) => entry.action.type === 'BUY_ITEM' && entry.action.itemId === 3);

    const result = applyRecommendationCandidateTransitionV1(current, buy, itemGraph);

    expect([...result.state.inventory.heldByItemId.keys()]).toEqual([3]);
    expect(result.addedItemIds).toEqual([3]);
    expect(result.removedItemIds).toEqual([]);
    expect(result.soulsDelta).toBe(-1200);
    expect(result.state.economy.spendableSouls.value).toBe(3800);
  });

  it('consumes the source item for UPGRADE atomically', () => {
    const itemGraph = graph();
    const current = state([1]);
    const candidates = generateRecommendationCandidates({ state: current, itemGraph, rules });
    const upgrade = candidate(candidates, (entry) => entry.action.type === 'UPGRADE_ITEM' && entry.action.itemId === 2);

    const result = applyRecommendationCandidateTransitionV1(current, upgrade, itemGraph);

    expect(result.consumedItemIds).toEqual([1]);
    expect(result.removedItemIds).toEqual([1]);
    expect(result.addedItemIds).toEqual([2]);
    expect(result.state.inventory.heldByItemId.has(1)).toBe(false);
    expect(result.state.inventory.heldByItemId.has(2)).toBe(true);
  });

  it('applies SELL and honors returned-item mechanics', () => {
    const itemGraph = graph();
    const current = state([2]);
    const candidates = generateRecommendationCandidates({ state: current, itemGraph, rules });
    const sell = candidate(candidates, (entry) => entry.action.type === 'SELL_ITEM' && entry.action.itemId === 2);

    const result = applyRecommendationCandidateTransitionV1(current, sell, itemGraph);

    expect([...result.state.inventory.heldByItemId.keys()]).toEqual([1]);
    expect(result.removedItemIds).toEqual([2]);
    expect(result.addedItemIds).toEqual([1]);
    expect(result.state.economy.spendableSouls.value).toBe(6200);
  });

  it('applies REPLACE as one validated transition', () => {
    const itemGraph = graph();
    const current = state([3]);
    const candidates = generateRecommendationCandidates({ state: current, itemGraph, rules });
    const replace = candidate(candidates, (entry) =>
      entry.action.type === 'REPLACE_ITEM' &&
      entry.action.sellItemId === 3 &&
      entry.action.buyItemId === 1,
    );

    const result = applyRecommendationCandidateTransitionV1(current, replace, itemGraph);

    expect([...result.state.inventory.heldByItemId.keys()]).toEqual([1]);
    expect(result.removedItemIds).toEqual([3]);
    expect(result.addedItemIds).toEqual([1]);
  });

  it('rejects a forged transition that sells a non-owned item', () => {
    const itemGraph = graph();
    const current = state([1]);
    const forged: RecommendationCandidate = {
      actionId: 'SELL_ITEM:3',
      action: { type: 'SELL_ITEM', itemId: 3 },
      feasible: true,
      reasons: ['FEASIBLE'],
      recommendationEligible: true,
      recommendationSuppressionReasons: [],
      effectiveCostSouls: -600,
      spendableSoulsAfter: 5600,
      resultingItemIds: [1],
      evidence: {
        spendableSouls: 'OBSERVED',
        shopOpportunity: 'OBSERVED',
        ruleset: 'RECONSTRUCTED',
        inventory: 'OBSERVED',
        transaction: 'RECONSTRUCTED',
      },
    };

    expect(() => applyRecommendationCandidateTransitionV1(current, forged, itemGraph))
      .toThrow('Cannot sell non-owned item 3');
  });
});
