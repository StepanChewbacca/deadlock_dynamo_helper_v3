import {
  RecommendationDecisionState,
} from './recommendation-action-domain';
import { RecommendationItemGraph } from './recommendation-item-graph';

export type UpgradeExecutionReasonCodeV1 =
  | 'TARGET_UNKNOWN'
  | 'UPGRADE_TRANSACTION_MECHANICS_UNKNOWN'
  | 'DIRECT_PURCHASE_NOT_SUPPORTED';

export type UpgradeExecutionResolutionV1 =
  | {
      kind: 'EXACT_OWNED';
      targetItemId: number;
    }
  | {
      kind: 'DIRECT_UPGRADE';
      sourceItemIds: readonly number[];
      targetItemId: number;
      recipeId: string;
      soulsCost: number;
    }
  | {
      kind: 'MULTI_STEP_UPGRADE';
      targetItemId: number;
      nextTargetItemId: number;
      pathItemIds: readonly number[];
      nextRecipeId: string;
      sourceItemIds: readonly number[];
      soulsCost: number;
    }
  | {
      kind: 'DIRECT_BUY';
      targetItemId: number;
      soulsCost: number;
    }
  | {
      kind: 'NOT_EXECUTABLE';
      targetItemId: number;
      reasonCodes: readonly UpgradeExecutionReasonCodeV1[];
    };

interface PathCandidateV1 {
  startItemId: number;
  pathItemIds: readonly number[];
  nextTargetItemId: number;
  nextRecipeId: string;
  sourceItemIds: readonly number[];
  soulsCost: number;
}

export function resolveUpgradeExecutionPathV1(
  state: RecommendationDecisionState,
  targetItemId: number,
  graph: RecommendationItemGraph,
): UpgradeExecutionResolutionV1 {
  const target = graph.getItem(targetItemId);
  if (!target) {
    return {
      kind: 'NOT_EXECUTABLE',
      targetItemId,
      reasonCodes: ['TARGET_UNKNOWN'],
    };
  }

  const ownedItemIds = [...state.inventory.heldByItemId.keys()].sort((a, b) => a - b);
  if (state.inventory.heldByItemId.has(targetItemId)) {
    return { kind: 'EXACT_OWNED', targetItemId };
  }

  const directRecipe = graph.getExecutableUpgradeRecipes(targetItemId)
    .filter((recipe) => recipe.consumedItemIds.every((itemId) => state.inventory.heldByItemId.has(itemId)))
    .sort((left, right) => left.recipeId.localeCompare(right.recipeId))[0];

  if (directRecipe) {
    return {
      kind: 'DIRECT_UPGRADE',
      sourceItemIds: [...directRecipe.consumedItemIds].sort((a, b) => a - b),
      targetItemId,
      recipeId: directRecipe.recipeId,
      soulsCost: directRecipe.soulsCost,
    };
  }

  const ownedAncestors = ownedItemIds.filter((itemId) => graph.isComponentAncestor(itemId, targetItemId));
  if (ownedAncestors.length > 0) {
    const path = findShortestExecutableProgression(ownedAncestors, targetItemId, state, graph);
    if (path) {
      return {
        kind: 'MULTI_STEP_UPGRADE',
        targetItemId,
        nextTargetItemId: path.nextTargetItemId,
        pathItemIds: path.pathItemIds,
        nextRecipeId: path.nextRecipeId,
        sourceItemIds: path.sourceItemIds,
        soulsCost: path.soulsCost,
      };
    }

    return {
      kind: 'NOT_EXECUTABLE',
      targetItemId,
      reasonCodes: ['UPGRADE_TRANSACTION_MECHANICS_UNKNOWN'],
    };
  }

  if (target.directPurchaseCost !== undefined) {
    return {
      kind: 'DIRECT_BUY',
      targetItemId,
      soulsCost: target.directPurchaseCost,
    };
  }

  return {
    kind: 'NOT_EXECUTABLE',
    targetItemId,
    reasonCodes: ['DIRECT_PURCHASE_NOT_SUPPORTED'],
  };
}

function findShortestExecutableProgression(
  ownedAncestors: readonly number[],
  targetItemId: number,
  state: RecommendationDecisionState,
  graph: RecommendationItemGraph,
): PathCandidateV1 | undefined {
  const candidates: PathCandidateV1[] = [];

  for (const startItemId of ownedAncestors) {
    const paths = findLineagePaths(startItemId, targetItemId, graph);
    for (const pathItemIds of paths) {
      if (pathItemIds.length < 3) continue;
      const nextTargetItemId = pathItemIds[1];
      const nextRecipe = graph.getExecutableUpgradeRecipes(nextTargetItemId)
        .filter((recipe) => recipe.consumedItemIds.includes(startItemId))
        .filter((recipe) => recipe.consumedItemIds.every((itemId) => state.inventory.heldByItemId.has(itemId)))
        .sort((left, right) => left.recipeId.localeCompare(right.recipeId))[0];
      if (!nextRecipe) continue;

      candidates.push({
        startItemId,
        pathItemIds,
        nextTargetItemId,
        nextRecipeId: nextRecipe.recipeId,
        sourceItemIds: [...nextRecipe.consumedItemIds].sort((a, b) => a - b),
        soulsCost: nextRecipe.soulsCost,
      });
    }
  }

  return candidates.sort((left, right) =>
    left.pathItemIds.length - right.pathItemIds.length ||
    left.nextTargetItemId - right.nextTargetItemId ||
    left.nextRecipeId.localeCompare(right.nextRecipeId) ||
    left.startItemId - right.startItemId
  )[0];
}

function findLineagePaths(
  startItemId: number,
  targetItemId: number,
  graph: RecommendationItemGraph,
): readonly number[][] {
  const result: number[][] = [];
  const queue: number[][] = [[startItemId]];
  let shortestLength: number | undefined;

  while (queue.length > 0) {
    const path = queue.shift() as number[];
    if (shortestLength !== undefined && path.length > shortestLength) break;
    const current = path[path.length - 1];
    if (current === targetItemId) {
      shortestLength = path.length;
      result.push(path);
      continue;
    }

    for (const nextItemId of graph.getDirectUpgradeIds(current)) {
      if (path.includes(nextItemId)) continue;
      if (nextItemId !== targetItemId && !graph.isComponentAncestor(nextItemId, targetItemId)) continue;
      queue.push([...path, nextItemId]);
    }
  }

  return result.sort((left, right) => {
    const length = left.length - right.length;
    if (length !== 0) return length;
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
  });
}
