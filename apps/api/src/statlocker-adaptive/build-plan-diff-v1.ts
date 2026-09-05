import {
  AdaptiveBuildPlanChangeV1,
  AdaptivePlannedItemV1,
} from '@deadlock-live-probe/shared';

export function diffAdaptiveBuildPlansV1(
  previous: readonly AdaptivePlannedItemV1[],
  next: readonly AdaptivePlannedItemV1[],
  recentPurchasedItemIds: readonly number[] = [],
  recentSoldItemIds: readonly number[] = [],
): readonly AdaptiveBuildPlanChangeV1[] {
  const previousByItem = new Map(previous.map((entry) => [entry.itemId, entry]));
  const nextByItem = new Map(next.map((entry) => [entry.itemId, entry]));
  const purchased = new Set(recentPurchasedItemIds);
  const sold = new Set(recentSoldItemIds);
  const changes: AdaptiveBuildPlanChangeV1[] = [];

  const replacement = detectObservedReplacement(previousByItem, nextByItem, purchased, sold);
  const consumed = new Set<number>();
  if (replacement) {
    consumed.add(replacement.sellItemId);
    consumed.add(replacement.buyItemId);
    changes.push({
      type: 'REPLACE',
      sellItemId: replacement.sellItemId,
      buyItemId: replacement.buyItemId,
      fromPosition: replacement.fromPosition,
      toPosition: replacement.toPosition,
      reasonCodes: ['OBSERVED_ONE_FOR_ONE_REPLACEMENT'],
    });
  }

  for (const entry of [...next].sort(byPositionThenItem)) {
    if (consumed.has(entry.itemId)) continue;
    const before = previousByItem.get(entry.itemId);
    if (!before) {
      changes.push({
        type: 'INSERT',
        itemId: entry.itemId,
        toPosition: entry.position,
        reasonCodes: purchased.has(entry.itemId) ? ['OBSERVED_PURCHASE_ENTERED_PLAN'] : ['STRATEGY_PLAN_INSERT'],
      });
      continue;
    }
    if (before.position !== entry.position) {
      changes.push({
        type: 'MOVE',
        itemId: entry.itemId,
        fromPosition: before.position,
        toPosition: entry.position,
        reasonCodes: ['STRATEGY_PLAN_REORDER'],
      });
      continue;
    }
    changes.push({
      type: 'KEEP',
      itemId: entry.itemId,
      fromPosition: before.position,
      toPosition: entry.position,
      reasonCodes: ['STRATEGY_PLAN_STABLE'],
    });
  }

  for (const entry of [...previous].sort(byPositionThenItem)) {
    if (consumed.has(entry.itemId) || nextByItem.has(entry.itemId)) continue;
    changes.push({
      type: sold.has(entry.itemId) ? 'SELL' : 'SKIP',
      itemId: entry.itemId,
      fromPosition: entry.position,
      reasonCodes: sold.has(entry.itemId) ? ['OBSERVED_ITEM_SOLD'] : ['STRATEGY_PLAN_REMOVED'],
    });
  }

  return changes;
}

function detectObservedReplacement(
  previousByItem: ReadonlyMap<number, AdaptivePlannedItemV1>,
  nextByItem: ReadonlyMap<number, AdaptivePlannedItemV1>,
  purchased: ReadonlySet<number>,
  sold: ReadonlySet<number>,
): { sellItemId: number; buyItemId: number; fromPosition?: number; toPosition?: number } | undefined {
  const soldCandidates = [...sold]
    .filter((itemId) => previousByItem.has(itemId) && !nextByItem.has(itemId))
    .sort((a, b) => a - b);
  const purchasedCandidates = [...purchased]
    .filter((itemId) => !previousByItem.has(itemId) && nextByItem.has(itemId))
    .sort((a, b) => a - b);
  if (soldCandidates.length !== 1 || purchasedCandidates.length !== 1) return undefined;
  const sellItemId = soldCandidates[0];
  const buyItemId = purchasedCandidates[0];
  return {
    sellItemId,
    buyItemId,
    fromPosition: previousByItem.get(sellItemId)?.position,
    toPosition: nextByItem.get(buyItemId)?.position,
  };
}

function byPositionThenItem(a: AdaptivePlannedItemV1, b: AdaptivePlannedItemV1): number {
  return a.position - b.position || a.itemId - b.itemId;
}
