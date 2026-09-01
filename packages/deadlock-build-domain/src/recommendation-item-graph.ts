import { RecommendationItemDefinition } from './recommendation-action-domain';

export interface RecommendationItemGraph {
  getItem(itemId: number): RecommendationItemDefinition | undefined;
  getAllItems(): readonly RecommendationItemDefinition[];
  getDirectComponentIds(itemId: number): readonly number[];
  getDirectUpgradeIds(itemId: number): readonly number[];
}

export function createRecommendationItemGraph(
  definitions: readonly RecommendationItemDefinition[],
): RecommendationItemGraph {
  const byId = new Map<number, RecommendationItemDefinition>();

  for (const source of definitions) {
    validateItem(source);
    if (byId.has(source.itemId)) {
      throw new Error(`Duplicate recommendation item definition: ${source.itemId}`);
    }
    byId.set(source.itemId, normalizeItem(source));
  }

  for (const item of byId.values()) {
    for (const recipe of item.upgradeRecipes) {
      for (const componentId of recipe.consumedItemIds) {
        if (!byId.has(componentId)) {
          throw new Error(`Upgrade recipe ${recipe.recipeId} references missing component ${componentId}`);
        }
      }
    }
    for (const returnedItemId of item.sellTransition?.returnedItemIds ?? []) {
      if (!byId.has(returnedItemId)) {
        throw new Error(`Sell transition for ${item.itemId} returns missing item ${returnedItemId}`);
      }
    }
  }

  assertAcyclic(byId);

  const directUpgrades = new Map<number, number[]>();
  for (const item of byId.values()) {
    for (const recipe of item.upgradeRecipes) {
      for (const componentId of recipe.consumedItemIds) {
        const targets = directUpgrades.get(componentId) ?? [];
        if (!targets.includes(item.itemId)) targets.push(item.itemId);
        directUpgrades.set(componentId, targets);
      }
    }
  }
  for (const values of directUpgrades.values()) values.sort((a, b) => a - b);

  const allItems = [...byId.values()].sort((a, b) => a.itemId - b.itemId);
  return {
    getItem: (itemId) => byId.get(itemId),
    getAllItems: () => allItems,
    getDirectComponentIds: (itemId) => {
      const item = byId.get(itemId);
      if (!item) return [];
      return [...new Set(item.upgradeRecipes.flatMap((recipe) => recipe.consumedItemIds))].sort((a, b) => a - b);
    },
    getDirectUpgradeIds: (itemId) => directUpgrades.get(itemId) ?? [],
  };
}

function validateItem(item: RecommendationItemDefinition): void {
  if (!Number.isInteger(item.itemId) || item.itemId <= 0) throw new Error(`Invalid item id: ${item.itemId}`);
  if (!item.name) throw new Error(`Item ${item.itemId} has no name`);
  if (!['weapon', 'vitality', 'spirit'].includes(item.slotType)) throw new Error(`Item ${item.itemId} has invalid slot type`);
  if (item.directPurchaseCost !== undefined && (!Number.isFinite(item.directPurchaseCost) || item.directPurchaseCost < 0)) {
    throw new Error(`Item ${item.itemId} has invalid direct purchase cost`);
  }
  if (item.maxCopies !== undefined && (!Number.isInteger(item.maxCopies) || item.maxCopies < 1)) {
    throw new Error(`Item ${item.itemId} has invalid maxCopies`);
  }
  if (item.sellTransition) {
    if (!Number.isFinite(item.sellTransition.soulsRefund) || item.sellTransition.soulsRefund < 0) {
      throw new Error(`Item ${item.itemId} has invalid sell refund`);
    }
  }
  const recipeIds = new Set<string>();
  for (const recipe of item.upgradeRecipes) {
    if (!recipe.recipeId) throw new Error(`Item ${item.itemId} has recipe without id`);
    if (recipeIds.has(recipe.recipeId)) throw new Error(`Duplicate recipe id ${recipe.recipeId} for item ${item.itemId}`);
    recipeIds.add(recipe.recipeId);
    if (!Number.isFinite(recipe.soulsCost) || recipe.soulsCost < 0) throw new Error(`Recipe ${recipe.recipeId} has invalid cost`);
    if (recipe.consumedItemIds.length === 0) throw new Error(`Recipe ${recipe.recipeId} has no components`);
  }
}

function normalizeItem(item: RecommendationItemDefinition): RecommendationItemDefinition {
  return {
    ...item,
    availableRulesetIds: [...new Set(item.availableRulesetIds)].sort(),
    upgradeRecipes: item.upgradeRecipes
      .map((recipe) => ({
        ...recipe,
        consumedItemIds: [...new Set(recipe.consumedItemIds)].sort((a, b) => a - b),
      }))
      .sort((a, b) => a.recipeId.localeCompare(b.recipeId)),
    sellTransition: item.sellTransition
      ? {
          soulsRefund: item.sellTransition.soulsRefund,
          returnedItemIds: [...new Set(item.sellTransition.returnedItemIds)].sort((a, b) => a - b),
        }
      : undefined,
  };
}

function assertAcyclic(byId: ReadonlyMap<number, RecommendationItemDefinition>): void {
  const state = new Map<number, 'VISITING' | 'DONE'>();
  const visit = (itemId: number): void => {
    const current = state.get(itemId);
    if (current === 'VISITING') throw new Error(`Recommendation upgrade graph contains a cycle at ${itemId}`);
    if (current === 'DONE') return;
    state.set(itemId, 'VISITING');
    const item = byId.get(itemId);
    for (const recipe of item?.upgradeRecipes ?? []) {
      for (const componentId of recipe.consumedItemIds) visit(componentId);
    }
    state.set(itemId, 'DONE');
  };
  for (const itemId of byId.keys()) visit(itemId);
}
