import {
  createRecommendationItemGraph,
  RecommendationItemDefinition,
} from '../src';

function item(
  itemId: number,
  components: readonly number[] = [],
): RecommendationItemDefinition {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: components.length === 0 ? 800 : undefined,
    upgradeRecipes: components.length === 0
      ? []
      : [{ recipeId: `upgrade-${itemId}`, consumedItemIds: components, soulsCost: 800 }],
    maxCopies: 1,
  };
}

describe('RecommendationItemGraph upgrade lineage', () => {
  it('resolves deterministic transitive component and upgrade closures', () => {
    const graph = createRecommendationItemGraph([
      item(1),
      item(2, [1]),
      item(3, [2]),
      item(4, [1]),
    ]);

    expect(graph.getTransitiveComponentIds(3)).toEqual([1, 2]);
    expect(graph.getTransitiveUpgradeIds(1)).toEqual([2, 3, 4]);
    expect(graph.isComponentAncestor(1, 3)).toBe(true);
    expect(graph.isComponentAncestor(3, 1)).toBe(false);
  });

  it('supports multi-component recipes and target satisfaction by descendants', () => {
    const graph = createRecommendationItemGraph([
      item(1),
      item(2),
      item(3, [1, 2]),
      item(4, [3]),
    ]);

    expect(graph.getTransitiveComponentIds(4)).toEqual([1, 2, 3]);
    expect(graph.isTargetSatisfied(1, [4])).toBe(true);
    expect(graph.isTargetSatisfied(3, [4])).toBe(true);
    expect(graph.isTargetSatisfied(4, [4])).toBe(true);
    expect(graph.isTargetSatisfied(2, [])).toBe(false);
    expect(graph.getSatisfyingOwnedItemIds(1, [4, 2])).toEqual([4]);
  });

  it('deduplicates satisfying inventory and returns deterministic owners', () => {
    const graph = createRecommendationItemGraph([
      item(1),
      item(2, [1]),
      item(3, [1]),
    ]);

    expect(graph.getSatisfyingOwnedItemIds(1, [3, 2, 3, 1])).toEqual([1, 2, 3]);
  });
});
