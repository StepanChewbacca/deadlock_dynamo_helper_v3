import {
  createRecommendationItemGraph,
  observedFact,
  resolveUpgradeExecutionPathV1,
} from '../src';

function item(
  itemId: number,
  upgradeRecipes: readonly { recipeId: string; consumedItemIds: readonly number[]; soulsCost: number }[] = [],
) {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-1'],
    directPurchaseCost: itemId * 800,
    upgradeRecipes,
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
  };
}

function state(itemIds: readonly number[]) {
  return {
    decisionId: 'decision-1',
    matchId: 'match-1',
    playerSlot: 0,
    gameTimeSec: 600,
    rulesetId: 'ruleset-1',
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
      spendableSouls: observedFact(10_000, 'test'),
      shopOpportunity: observedFact('AVAILABLE' as const, 'test'),
    },
  };
}

describe('resolveUpgradeExecutionPathV1', () => {
  it('resolves an executable direct upgrade', () => {
    const graph = createRecommendationItemGraph([
      item(1),
      item(2, [{ recipeId: 'upgrade:2', consumedItemIds: [1], soulsCost: 1600 }]),
    ]);

    expect(resolveUpgradeExecutionPathV1(state([1]), 2, graph)).toEqual({
      kind: 'DIRECT_UPGRADE',
      sourceItemIds: [1],
      targetItemId: 2,
      recipeId: 'upgrade:2',
      soulsCost: 1600,
    });
  });

  it('resolves the next step of a multi-step upgrade without jumping directly', () => {
    const graph = createRecommendationItemGraph([
      item(1),
      item(2, [{ recipeId: 'upgrade:2', consumedItemIds: [1], soulsCost: 800 }]),
      item(3, [{ recipeId: 'upgrade:3', consumedItemIds: [2], soulsCost: 1600 }]),
    ]);

    expect(resolveUpgradeExecutionPathV1(state([1]), 3, graph)).toEqual({
      kind: 'MULTI_STEP_UPGRADE',
      targetItemId: 3,
      nextTargetItemId: 2,
      pathItemIds: [1, 2, 3],
      nextRecipeId: 'upgrade:2',
      sourceItemIds: [1],
      soulsCost: 800,
    });
  });

  it('requires every component for a multi-component direct recipe', () => {
    const graph = createRecommendationItemGraph([
      item(1),
      item(2),
      item(3, [{ recipeId: 'upgrade:3', consumedItemIds: [1, 2], soulsCost: 1200 }]),
    ]);

    expect(resolveUpgradeExecutionPathV1(state([1, 2]), 3, graph).kind).toBe('DIRECT_UPGRADE');
    expect(resolveUpgradeExecutionPathV1(state([1]), 3, graph)).toEqual({
      kind: 'NOT_EXECUTABLE',
      targetItemId: 3,
      reasonCodes: ['UPGRADE_TRANSACTION_MECHANICS_UNKNOWN'],
    });
  });

  it('fails closed when lineage is known but transaction mechanics are absent', () => {
    const graph = createRecommendationItemGraph(
      [item(1), item(2)],
      [{ parentItemId: 2, componentItemId: 1 }],
    );

    expect(resolveUpgradeExecutionPathV1(state([1]), 2, graph)).toEqual({
      kind: 'NOT_EXECUTABLE',
      targetItemId: 2,
      reasonCodes: ['UPGRADE_TRANSACTION_MECHANICS_UNKNOWN'],
    });
  });

  it('allows a direct buy only when no owned lineage component claims the target', () => {
    const graph = createRecommendationItemGraph([item(1), item(4)]);

    expect(resolveUpgradeExecutionPathV1(state([1]), 4, graph)).toEqual({
      kind: 'DIRECT_BUY',
      targetItemId: 4,
      soulsCost: 3200,
    });
  });
});
