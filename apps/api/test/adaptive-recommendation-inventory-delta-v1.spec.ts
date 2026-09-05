import { deriveInventoryDeltaV1 } from '../src/statlocker-adaptive/adaptive-recommendation-v1.service';

describe('adaptive recommendation inventory delta', () => {
  it('derives purchases and sells deterministically from exact snapshots', () => {
    expect(deriveInventoryDeltaV1([1, 2, 4], [2, 3, 4])).toEqual({
      purchasedItemIds: [3],
      soldItemIds: [1],
    });
  });

  it('treats upgrade component consumption as a removed exact item while the descendant is purchased', () => {
    expect(deriveInventoryDeltaV1([10], [20])).toEqual({
      purchasedItemIds: [20],
      soldItemIds: [10],
    });
  });

  it('deduplicates and sorts malformed historical arrays instead of creating churn noise', () => {
    expect(deriveInventoryDeltaV1([2, 1, 1], [3, 2, 3])).toEqual({
      purchasedItemIds: [3],
      soldItemIds: [1],
    });
  });
});
