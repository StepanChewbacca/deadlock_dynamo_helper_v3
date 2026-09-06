import {
  ItemUpgradeRecipe,
  RecommendationItemDefinition,
} from './recommendation-action-domain';

export interface RecommendationItemLineageEdge {
  parentItemId: number;
  componentItemId: number;
}

export interface RecommendationItemGraph {
  getItem(itemId: number): RecommendationItemDefinition | undefined;
  getAllItems(): readonly RecommendationItemDefinition[];
  getExecutableUpgradeRecipes(itemId: number): readonly ItemUpgradeRecipe[];
  getDirectComponentIds(itemId: number): readonly number[];
  getDirectUpgradeIds(itemId: number): readonly number[];
  getTransitiveComponentIds(itemId: number): readonly number[];
  getTransitiveUpgradeIds(itemId: number): readonly number[];
  isComponentAncestor(componentItemId: number, upgradedItemId: number): boolean;
  isTargetSatisfied(targetItemId: number, ownedItemIds: Iterable<number>): boolean;
  getSatisfyingOwnedItemIds(targetItemId: number, ownedItemIds: Iterable<number>): readonly number[];
}

export function createRecommendationItemGraph(
  definitions: readonly RecommendationItemDefinition[],
  lineageEdges: readonly RecommendationItemLineageEdge[] = [],
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

  const directComponents = new Map<number, number[]>();
  const addDirectEdge = (parentItemId: number, componentItemId: number): void => {
    if (!byId.has(parentItemId)) throw new Error(`Lineage parent ${parentItemId} does not exist`);
    if (!byId.has(componentItemId)) throw new Error(`Lineage component ${componentItemId} does not exist`);
    const components = directComponents.get(parentItemId) ?? [];
    if (!components.includes(componentItemId)) components.push(componentItemId);
    directComponents.set(parentItemId, components);
  };

  for (const item of byId.values()) {
    for (const recipe of item.upgradeRecipes) {
      for (const componentId of recipe.consumedItemIds) addDirectEdge(item.itemId, componentId);
    }
  }
  for (const edge of lineageEdges) addDirectEdge(edge.parentItemId, edge.componentItemId);
  for (const values of directComponents.values()) values.sort((a, b) => a - b);

  assertAcyclic(byId, directComponents);

  const directUpgrades = new Map<number, number[]>();
  for (const [parentItemId, componentIds] of directComponents) {
    for (const componentId of componentIds) {
      const targets = directUpgrades.get(componentId) ?? [];
      if (!targets.includes(parentItemId)) targets.push(parentItemId);
      directUpgrades.set(componentId, targets);
    }
  }
  for (const values of directUpgrades.values()) values.sort((a, b) => a - b);

  const transitiveComponents = new Map<number, readonly number[]>();
  const transitiveUpgrades = new Map<number, readonly number[]>();

  const resolveComponents = (itemId: number): readonly number[] => {
    const cached = transitiveComponents.get(itemId);
    if (cached) return cached;

    const result = new Set<number>();
    for (const componentId of directComponents.get(itemId) ?? []) {
      result.add(componentId);
      for (const ancestorId of resolveComponents(componentId)) result.add(ancestorId);
    }
    const sorted = [...result].sort((a, b) => a - b);
    transitiveComponents.set(itemId, sorted);
    return sorted;
  };

  const resolveUpgrades = (itemId: number): readonly number[] => {
    const cached = transitiveUpgrades.get(itemId);
    if (cached) return cached;

    const result = new Set<number>();
    for (const upgradeId of directUpgrades.get(itemId) ?? []) {
      result.add(upgradeId);
      for (const descendantId of resolveUpgrades(upgradeId)) result.add(descendantId);
    }
    const sorted = [...result].sort((a, b) => a - b);
    transitiveUpgrades.set(itemId, sorted);
    return sorted;
  };

  for (const itemId of byId.keys()) {
    resolveComponents(itemId);
    resolveUpgrades(itemId);
  }

  const allItems = [...byId.values()].sort((a, b) => a.itemId - b.itemId);
  return {
    getItem: (itemId) => byId.get(itemId),
    getAllItems: () => allItems,
    getExecutableUpgradeRecipes: (itemId) => byId.get(itemId)?.upgradeRecipes ?? [],
    getDirectComponentIds: (itemId) => directComponents.get(itemId) ?? [],
    getDirectUpgradeIds: (itemId) => directUpgrades.get(itemId) ?? [],
    getTransitiveComponentIds: (itemId) => transitiveComponents.get(itemId) ?? [],
    getTransitiveUpgradeIds: (itemId) => transitiveUpgrades.get(itemId) ?? [],
    isComponentAncestor: (componentItemId, upgradedItemId) =>
      (transitiveComponents.get(upgradedItemId) ?? []).includes(componentItemId),
    isTargetSatisfied: (targetItemId, ownedItemIds) => {
      for (const ownedItemId of ownedItemIds) {
        if (ownedItemId === targetItemId) return true;
        if ((transitiveComponents.get(ownedItemId) ?? []).includes(targetItemId)) return true;
      }
      return false;
    },
    getSatisfyingOwnedItemIds: (targetItemId, ownedItemIds) => [...new Set(ownedItemIds)]
      .filter((ownedItemId) =>
        ownedItemId === targetItemId || (transitiveComponents.get(ownedItemId) ?? []).includes(targetItemId),
      )
      .sort((a, b) => a - b),
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

function assertAcyclic(
  byId: ReadonlyMap<number, RecommendationItemDefinition>,
  directComponents: ReadonlyMap<number, readonly number[]>,
): void {
  const state = new Map<number, 'VISITING' | 'DONE'>();
  const visit = (itemId: number): void => {
    const current = state.get(itemId);
    if (current === 'VISITING') throw new Error(`Recommendation upgrade graph contains a cycle at ${itemId}`);
    if (current === 'DONE') return;
    state.set(itemId, 'VISITING');
    for (const componentId of directComponents.get(itemId) ?? []) visit(componentId);
    state.set(itemId, 'DONE');
  };
  for (const itemId of byId.keys()) visit(itemId);
}
