import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { deriveInventoryDeltaV1 } from '../src/statlocker-adaptive/adaptive-recommendation-v1.service';

const graph = createRecommendationItemGraph([
  {
    itemId: 10, name: 'Component', slotType: 'weapon', active: false, availableRulesetIds: ['r1'],
    directPurchaseCost: 500, upgradeRecipes: [], sellTransition: { soulsRefund: 250, returnedItemIds: [] },
  },
  {
    itemId: 20, name: 'Upgrade', slotType: 'weapon', active: false, availableRulesetIds: ['r1'],
    upgradeRecipes: [{ recipeId: 'u20', consumedItemIds: [10], soulsCost: 500 }],
    sellTransition: { soulsRefund: 500, returnedItemIds: [10] },
  },
]);

describe('adaptive recommendation inventory delta', () => {
  it('derives purchases and sells deterministically from exact snapshots', () => {
    expect(deriveInventoryDeltaV1([1, 2, 4], [2, 3, 4])).toEqual({
      purchasedItemIds: [3],
      soldItemIds: [1],
      consumedItemIds: [],
    });
  });

  it('does not report a consumed upgrade component as a sell', () => {
    expect(deriveInventoryDeltaV1([10], [20], graph)).toEqual({
      purchasedItemIds: [20],
      soldItemIds: [],
      consumedItemIds: [10],
    });
  });

  it('deduplicates and sorts malformed historical arrays instead of creating churn noise', () => {
    expect(deriveInventoryDeltaV1([2, 1, 1], [3, 2, 3])).toEqual({
      purchasedItemIds: [3],
      soldItemIds: [1],
      consumedItemIds: [],
    });
  });
});
