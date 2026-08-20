import {
  applyInventoryAction,
  InventoryReducerContext,
} from './inventory-reducer';
import {
  InventoryActionMetadata,
  InventoryItem,
  InventoryRuleset,
  InventoryState,
  RecipeGraph,
} from './types';

export type RecommendationAction =
  | { type: 'WAIT' }
  | { type: 'BUY'; itemId: number }
  | { type: 'UPGRADE'; itemId: number; consumedComponentIds: number[] }
  | { type: 'SELL'; itemId: number }
  | { type: 'REPLACE'; sellItemId: number; buyItemId: number };

export interface RecommendationCatalogItem extends InventoryItem {
  slotType: NonNullable<InventoryItem['slotType']>;
  cost: number;
  tier: number;
  shopable: boolean;
  disabled: boolean;
  active: boolean;
}

export interface RecommendationExactEconomy {
  spendableSouls: number;
  buyCostByItemId: ReadonlyMap<number, number>;
  upgradeCostByItemId: ReadonlyMap<number, number>;
  sellRefundByItemId: ReadonlyMap<number, number>;
}

export interface RecommendationActionCandidate {
  actionId: string;
  action: RecommendationAction;
  effectiveCost: number;
  soulsDelta: number;
  spendableSoulsAfter: number;
}

export type RecommendationActionDiagnosticCode =
  | 'INVALID_SPENDABLE_SOULS'
  | 'DUPLICATE_CATALOG_ITEM_ID'
  | 'INVALID_ECONOMY_VALUE'
  | 'RECIPE_REQUIRES_DUPLICATE_COMPONENT_INSTANCE';

export interface RecommendationActionDiagnostic {
  code: RecommendationActionDiagnosticCode;
  message: string;
  itemIds: number[];
}

export interface GenerateRecommendationActionsInput {
  state: InventoryState;
  catalogItems: readonly RecommendationCatalogItem[];
  recipeGraph: RecipeGraph;
  ruleset: InventoryRuleset;
  economy?: RecommendationExactEconomy;
  observedAtMs: number;
  gameTimeSec?: number;
}

export interface GenerateRecommendationActionsResult {
  candidates: RecommendationActionCandidate[];
  diagnostics: RecommendationActionDiagnostic[];
}

export interface SimulateRecommendationActionInput {
  state: InventoryState;
  action: RecommendationAction;
  catalogByItemId: ReadonlyMap<number, RecommendationCatalogItem>;
  recipeGraph: RecipeGraph;
  ruleset: InventoryRuleset;
  observedAtMs: number;
  gameTimeSec?: number;
}

export interface SimulateRecommendationActionSuccess {
  ok: true;
  state: InventoryState;
}

export interface SimulateRecommendationActionFailure {
  ok: false;
  state: InventoryState;
  reason: string;
}

export type SimulateRecommendationActionResult =
  | SimulateRecommendationActionSuccess
  | SimulateRecommendationActionFailure;

export function generateLegalRecommendationActions(
  input: GenerateRecommendationActionsInput,
): GenerateRecommendationActionsResult {
  const diagnostics: RecommendationActionDiagnostic[] = [];
  const catalogByItemId = new Map<number, RecommendationCatalogItem>();

  for (const item of input.catalogItems) {
    if (catalogByItemId.has(item.itemId)) {
      diagnostics.push({
        code: 'DUPLICATE_CATALOG_ITEM_ID',
        message: `Catalog contains duplicate item id ${item.itemId}.`,
        itemIds: [item.itemId],
      });
      continue;
    }
    catalogByItemId.set(item.itemId, item);
  }

  const hasValidSpendableSouls =
    input.economy !== undefined && isValidEconomyAmount(input.economy.spendableSouls);
  const waitCandidate: RecommendationActionCandidate = {
    actionId: 'WAIT',
    action: { type: 'WAIT' },
    effectiveCost: 0,
    soulsDelta: 0,
    spendableSoulsAfter: hasValidSpendableSouls ? input.economy!.spendableSouls : 0,
  };

  if (diagnostics.some((diagnostic) => diagnostic.code === 'DUPLICATE_CATALOG_ITEM_ID')) {
    return { candidates: [waitCandidate], diagnostics };
  }

  if (!hasValidSpendableSouls || !input.economy) {
    diagnostics.push({
      code: 'INVALID_SPENDABLE_SOULS',
      message: 'Validated spendable souls are required before economic actions can be generated.',
      itemIds: [],
    });
    return { candidates: [waitCandidate], diagnostics };
  }

  const economyDiagnostics = validateEconomyMaps(input.economy, catalogByItemId);
  if (economyDiagnostics.length > 0) {
    diagnostics.push(...economyDiagnostics);
    return { candidates: [waitCandidate], diagnostics };
  }

  const candidates: RecommendationActionCandidate[] = [waitCandidate];

  for (const heldItemId of [...input.state.heldByItemId.keys()].sort((a, b) => a - b)) {
    const refund = input.economy.sellRefundByItemId.get(heldItemId);
    if (!isValidEconomyAmount(refund)) continue;

    const action: RecommendationAction = { type: 'SELL', itemId: heldItemId };
    if (!isStructurallyLegal(input, catalogByItemId, action)) continue;
    candidates.push(
      createCandidate(action, 0, refund, input.economy.spendableSouls + refund),
    );
  }

  for (const item of [...catalogByItemId.values()].sort((a, b) => a.itemId - b.itemId)) {
    if (!isCatalogItemPurchasable(item) || input.state.heldByItemId.has(item.itemId)) continue;

    const componentItemIds = [...input.recipeGraph.getComponentIds(item.itemId)];
    if (componentItemIds.length > 0) {
      if (containsDuplicates(componentItemIds)) {
        diagnostics.push({
          code: 'RECIPE_REQUIRES_DUPLICATE_COMPONENT_INSTANCE',
          message: `Recipe ${item.itemId} requires duplicate component instances, which the current inventory state model cannot represent exactly.`,
          itemIds: [item.itemId, ...componentItemIds].sort((a, b) => a - b),
        });
        continue;
      }
      if (!componentItemIds.every((componentItemId) => input.state.heldByItemId.has(componentItemId))) {
        continue;
      }

      const upgradeCost = input.economy.upgradeCostByItemId.get(item.itemId);
      if (!isValidEconomyAmount(upgradeCost)) continue;
      if (upgradeCost > input.economy.spendableSouls) continue;

      const action: RecommendationAction = {
        type: 'UPGRADE',
        itemId: item.itemId,
        consumedComponentIds: [...componentItemIds].sort((a, b) => a - b),
      };
      if (!isStructurallyLegal(input, catalogByItemId, action)) continue;
      candidates.push(
        createCandidate(
          action,
          upgradeCost,
          -upgradeCost,
          input.economy.spendableSouls - upgradeCost,
        ),
      );
      continue;
    }

    const buyCost = input.economy.buyCostByItemId.get(item.itemId);
    if (!isValidEconomyAmount(buyCost)) continue;

    const buyAction: RecommendationAction = { type: 'BUY', itemId: item.itemId };
    const directBuyLegal = isStructurallyLegal(input, catalogByItemId, buyAction);
    const directBuyAffordable = buyCost <= input.economy.spendableSouls;
    if (directBuyLegal && directBuyAffordable) {
      candidates.push(
        createCandidate(
          buyAction,
          buyCost,
          -buyCost,
          input.economy.spendableSouls - buyCost,
        ),
      );
    }

    if (directBuyLegal) {
      continue;
    }

    for (const sellItemId of [...input.state.heldByItemId.keys()].sort((a, b) => a - b)) {
      const sellRefund = input.economy.sellRefundByItemId.get(sellItemId);
      if (!isValidEconomyAmount(sellRefund)) continue;
      if (buyCost > input.economy.spendableSouls + sellRefund) continue;

      const replaceAction: RecommendationAction = {
        type: 'REPLACE',
        sellItemId,
        buyItemId: item.itemId,
      };
      if (!isStructurallyLegal(input, catalogByItemId, replaceAction)) continue;
      candidates.push(
        createCandidate(
          replaceAction,
          Math.max(0, buyCost - sellRefund),
          sellRefund - buyCost,
          input.economy.spendableSouls + sellRefund - buyCost,
        ),
      );
    }
  }

  return {
    candidates: deduplicateCandidates(candidates).sort(compareCandidates),
    diagnostics,
  };
}

export function simulateRecommendationAction(
  input: SimulateRecommendationActionInput,
): SimulateRecommendationActionResult {
  const metadata = createMetadata(input.observedAtMs, input.gameTimeSec);
  const context: InventoryReducerContext = {
    recipeGraph: input.recipeGraph,
    ruleset: input.ruleset,
  };

  switch (input.action.type) {
    case 'WAIT':
      return { ok: true, state: input.state };
    case 'BUY': {
      const item = input.catalogByItemId.get(input.action.itemId);
      if (!item) return unknownCatalogItem(input.state, input.action.itemId);
      return normalizeReducerResult(
        applyInventoryAction(input.state, { type: 'BUY', item, metadata }, context),
      );
    }
    case 'UPGRADE': {
      const item = input.catalogByItemId.get(input.action.itemId);
      if (!item) return unknownCatalogItem(input.state, input.action.itemId);
      return normalizeReducerResult(
        applyInventoryAction(
          input.state,
          {
            type: 'UPGRADE',
            item,
            consumedComponentIds: input.action.consumedComponentIds,
            metadata,
          },
          context,
        ),
      );
    }
    case 'SELL':
      return normalizeReducerResult(
        applyInventoryAction(
          input.state,
          { type: 'SELL', itemId: input.action.itemId, metadata },
          context,
        ),
      );
    case 'REPLACE': {
      const item = input.catalogByItemId.get(input.action.buyItemId);
      if (!item) return unknownCatalogItem(input.state, input.action.buyItemId);
      const sold = applyInventoryAction(
        input.state,
        { type: 'SELL', itemId: input.action.sellItemId, metadata },
        context,
      );
      if (!sold.ok) return normalizeReducerResult(sold);
      return normalizeReducerResult(
        applyInventoryAction(sold.state, { type: 'BUY', item, metadata }, context),
      );
    }
  }
}

export function recommendationActionId(action: RecommendationAction): string {
  switch (action.type) {
    case 'WAIT':
      return 'WAIT';
    case 'BUY':
      return `BUY:${action.itemId}`;
    case 'UPGRADE':
      return `UPGRADE:${action.itemId}:${[...action.consumedComponentIds]
        .sort((a, b) => a - b)
        .join(',')}`;
    case 'SELL':
      return `SELL:${action.itemId}`;
    case 'REPLACE':
      return `REPLACE:${action.sellItemId}->${action.buyItemId}`;
  }
}

function isStructurallyLegal(
  input: GenerateRecommendationActionsInput,
  catalogByItemId: ReadonlyMap<number, RecommendationCatalogItem>,
  action: RecommendationAction,
): boolean {
  return simulateRecommendationAction({
    state: input.state,
    action,
    catalogByItemId,
    recipeGraph: input.recipeGraph,
    ruleset: input.ruleset,
    observedAtMs: input.observedAtMs,
    gameTimeSec: input.gameTimeSec,
  }).ok;
}

function isCatalogItemPurchasable(item: RecommendationCatalogItem): boolean {
  return item.shopable && item.active && !item.disabled;
}

function createCandidate(
  action: RecommendationAction,
  effectiveCost: number,
  soulsDelta: number,
  spendableSoulsAfter: number,
): RecommendationActionCandidate {
  return {
    actionId: recommendationActionId(action),
    action,
    effectiveCost,
    soulsDelta,
    spendableSoulsAfter,
  };
}

function createMetadata(observedAtMs: number, gameTimeSec: number | undefined): InventoryActionMetadata {
  return {
    observedAtMs,
    gameTimeSec,
    evidence: 'DERIVED',
    source: 'SYSTEM',
  };
}

function validateEconomyMaps(
  economy: RecommendationExactEconomy,
  catalogByItemId: ReadonlyMap<number, RecommendationCatalogItem>,
): RecommendationActionDiagnostic[] {
  const diagnostics: RecommendationActionDiagnostic[] = [];
  const maps: Array<[string, ReadonlyMap<number, number>]> = [
    ['buy', economy.buyCostByItemId],
    ['upgrade', economy.upgradeCostByItemId],
    ['sell', economy.sellRefundByItemId],
  ];

  for (const [label, values] of maps) {
    for (const [itemId, value] of values.entries()) {
      if (!catalogByItemId.has(itemId) || isValidEconomyAmount(value)) continue;
      diagnostics.push({
        code: 'INVALID_ECONOMY_VALUE',
        message: `${label} economy value for item ${itemId} must be a non-negative safe integer.`,
        itemIds: [itemId],
      });
    }
  }

  return diagnostics;
}

function normalizeReducerResult(
  result: ReturnType<typeof applyInventoryAction>,
): SimulateRecommendationActionResult {
  return result.ok
    ? { ok: true, state: result.state }
    : { ok: false, state: result.state, reason: result.error.code };
}

function unknownCatalogItem(state: InventoryState, itemId: number): SimulateRecommendationActionFailure {
  return {
    ok: false,
    state,
    reason: `UNKNOWN_CATALOG_ITEM:${itemId}`,
  };
}

function deduplicateCandidates(
  candidates: readonly RecommendationActionCandidate[],
): RecommendationActionCandidate[] {
  const byActionId = new Map<string, RecommendationActionCandidate>();
  for (const candidate of candidates) byActionId.set(candidate.actionId, candidate);
  return [...byActionId.values()];
}

function compareCandidates(
  left: RecommendationActionCandidate,
  right: RecommendationActionCandidate,
): number {
  if (left.action.type === 'WAIT' && right.action.type !== 'WAIT') return -1;
  if (left.action.type !== 'WAIT' && right.action.type === 'WAIT') return 1;
  return left.actionId.localeCompare(right.actionId);
}

function containsDuplicates(values: readonly number[]): boolean {
  return new Set(values).size !== values.length;
}

function isValidEconomyAmount(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}
