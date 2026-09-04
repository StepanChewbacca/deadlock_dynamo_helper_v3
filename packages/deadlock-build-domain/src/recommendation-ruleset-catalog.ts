import {
  FactEvidence,
  ObservedFact,
  RecommendationItemDefinition,
  observedFact,
  reconstructedFact,
  unknownFact,
} from './recommendation-action-domain';
import {
  createRecommendationItemGraph,
  RecommendationItemGraph,
  RecommendationItemLineageEdge,
} from './recommendation-item-graph';
import { InventorySlotType } from './types';

export const RECOMMENDATION_RULESET_CATALOG_SCHEMA_VERSION = 1 as const;

export interface RawCatalogVersionV1 {
  catalogVersionId: string;
  contentCatalogVersionId?: string;
  clientVersion?: string;
  rulesetId?: string;
  rulesetKey?: string;
  source: string;
  payloadSha256?: string;
  importedAt?: string;
}

export interface RawCatalogItemV1 {
  itemId: number;
  name: string;
  className?: string;
  itemType?: string;
  slotType?: string;
  cost?: number;
  tier?: number;
  shopable?: boolean;
  disabled?: boolean;
  active?: boolean;
  isActiveItem?: boolean;
  activationType?: string;
  rawPayload?: unknown;
}

export interface RawCatalogRecipeEdgeV1 {
  parentItemId: number;
  componentItemId: number;
  componentOrder?: number;
}

export interface RecommendationMechanicsEnrichmentV1 {
  itemId: number;
  maxCopies?: ObservedFact<number>;
  sellTransition?: {
    soulsRefund: ObservedFact<number>;
    returnedItemIds: ObservedFact<readonly number[]>;
  };
  upgradeRecipeCosts?: readonly {
    recipeId: string;
    soulsCost: ObservedFact<number>;
  }[];
}

export interface CatalogUpgradeRecipeV1 {
  recipeId: string;
  consumedItemIds: readonly number[];
  soulsCost: ObservedFact<number>;
}

export interface RecommendationCatalogItemV1 {
  itemId: number;
  name: string;
  className?: string;
  slotType: ObservedFact<InventorySlotType>;
  activeItem: ObservedFact<boolean>;
  rulesetAvailable: ObservedFact<boolean>;
  shopable: ObservedFact<boolean>;
  disabled: ObservedFact<boolean>;
  directPurchaseCost: ObservedFact<number>;
  upgradeRecipes: readonly CatalogUpgradeRecipeV1[];
  sellTransition: {
    soulsRefund: ObservedFact<number>;
    returnedItemIds: ObservedFact<readonly number[]>;
  };
  maxCopies: ObservedFact<number>;
}

export interface RecommendationRulesetCatalogCoverageV1 {
  totalItems: number;
  candidateItems: number;
  slotTypeKnown: number;
  activeItemKnown: number;
  directPurchaseCostKnown: number;
  upgradeRecipeTopologyKnown: number;
  upgradeTransactionCostKnown: number;
  sellTransitionKnown: number;
  rulesetAvailabilityKnown: number;
  strictCompilableItems: number;
}

export interface RecommendationRulesetCatalogV1 {
  schemaVersion: typeof RECOMMENDATION_RULESET_CATALOG_SCHEMA_VERSION;
  catalogVersionId: string;
  rulesetId: string;
  contentCatalogVersionId?: string;
  clientVersion?: string;
  source: string;
  payloadSha256?: string;
  importedAt?: string;
  items: readonly RecommendationCatalogItemV1[];
  coverage: RecommendationRulesetCatalogCoverageV1;
}

export interface BuildRulesetCatalogInputV1 {
  version: RawCatalogVersionV1;
  items: readonly RawCatalogItemV1[];
  recipeEdges: readonly RawCatalogRecipeEdgeV1[];
  mechanics?: readonly RecommendationMechanicsEnrichmentV1[];
}

export interface CompiledRecommendationCatalogV1 {
  catalogVersionId: string;
  rulesetId: string;
  graph: RecommendationItemGraph;
  excludedItemIds: readonly number[];
  coverage: RecommendationRulesetCatalogCoverageV1;
}

export function buildRecommendationRulesetCatalogV1(
  input: BuildRulesetCatalogInputV1,
): RecommendationRulesetCatalogV1 {
  if (!input.version.catalogVersionId) throw new Error('catalogVersionId is required');
  const rulesetId = canonicalRulesetId(input.version);
  const itemsById = new Map<number, RawCatalogItemV1>();
  for (const item of input.items) {
    if (!Number.isInteger(item.itemId) || item.itemId <= 0) throw new Error(`Invalid catalog item id ${item.itemId}`);
    if (itemsById.has(item.itemId)) throw new Error(`Duplicate catalog item id ${item.itemId}`);
    itemsById.set(item.itemId, item);
  }

  const edgesByParent = new Map<number, RawCatalogRecipeEdgeV1[]>();
  for (const edge of input.recipeEdges) {
    if (!itemsById.has(edge.parentItemId)) throw new Error(`Recipe parent ${edge.parentItemId} does not exist`);
    if (!itemsById.has(edge.componentItemId)) throw new Error(`Recipe component ${edge.componentItemId} does not exist`);
    const edges = edgesByParent.get(edge.parentItemId) ?? [];
    if (edges.some((current) => current.componentItemId === edge.componentItemId)) {
      throw new Error(`Duplicate recipe edge ${edge.parentItemId}->${edge.componentItemId}`);
    }
    edges.push(edge);
    edgesByParent.set(edge.parentItemId, edges);
  }

  const mechanicsById = new Map((input.mechanics ?? []).map((entry) => [entry.itemId, entry]));
  const items = [...itemsById.values()]
    .sort((a, b) => a.itemId - b.itemId)
    .map((raw) => buildCatalogItem(raw, edgesByParent.get(raw.itemId) ?? [], mechanicsById.get(raw.itemId), rulesetId));
  const coverage = calculateCoverage(items);

  return {
    schemaVersion: RECOMMENDATION_RULESET_CATALOG_SCHEMA_VERSION,
    catalogVersionId: input.version.catalogVersionId,
    rulesetId,
    contentCatalogVersionId: input.version.contentCatalogVersionId,
    clientVersion: input.version.clientVersion,
    source: input.version.source,
    payloadSha256: input.version.payloadSha256,
    importedAt: input.version.importedAt,
    items,
    coverage,
  };
}

export function compileStrictRecommendationCatalogV1(
  catalog: RecommendationRulesetCatalogV1,
): CompiledRecommendationCatalogV1 {
  const definitions: RecommendationItemDefinition[] = [];
  const excludedItemIds: number[] = [];
  for (const item of catalog.items) {
    if (!hasValue(item.slotType) || !hasValue(item.activeItem) || !hasValue(item.rulesetAvailable) || !hasValue(item.shopable) || !hasValue(item.disabled)) {
      excludedItemIds.push(item.itemId);
      continue;
    }
    const directPurchaseCost = item.shopable.value && !item.disabled.value && hasValue(item.directPurchaseCost)
      ? item.directPurchaseCost.value
      : undefined;
    const upgradeRecipes = item.upgradeRecipes
      .filter((recipe) => hasValue(recipe.soulsCost))
      .map((recipe) => ({
        recipeId: recipe.recipeId,
        consumedItemIds: recipe.consumedItemIds,
        soulsCost: recipe.soulsCost.value as number,
      }));
    const sellTransition = hasValue(item.sellTransition.soulsRefund) && hasValue(item.sellTransition.returnedItemIds)
      ? {
          soulsRefund: item.sellTransition.soulsRefund.value as number,
          returnedItemIds: item.sellTransition.returnedItemIds.value as readonly number[],
        }
      : undefined;
    definitions.push({
      itemId: item.itemId,
      name: item.name,
      slotType: item.slotType.value as InventorySlotType,
      active: item.activeItem.value as boolean,
      availableRulesetIds: item.rulesetAvailable.value ? [catalog.rulesetId] : [],
      directPurchaseCost,
      upgradeRecipes,
      sellTransition,
      maxCopies: hasValue(item.maxCopies) ? item.maxCopies.value : undefined,
    });
  }

  const compiledIds = new Set(definitions.map((item) => item.itemId));
  const lineageEdges: RecommendationItemLineageEdge[] = catalog.items
    .filter((item) => compiledIds.has(item.itemId))
    .flatMap((item) => item.upgradeRecipes.flatMap((recipe) =>
      recipe.consumedItemIds
        .filter((componentItemId) => compiledIds.has(componentItemId))
        .map((componentItemId) => ({ parentItemId: item.itemId, componentItemId })),
    ));

  return {
    catalogVersionId: catalog.catalogVersionId,
    rulesetId: catalog.rulesetId,
    graph: createRecommendationItemGraph(definitions, lineageEdges),
    excludedItemIds,
    coverage: catalog.coverage,
  };
}

function buildCatalogItem(
  raw: RawCatalogItemV1,
  recipeEdges: readonly RawCatalogRecipeEdgeV1[],
  mechanics: RecommendationMechanicsEnrichmentV1 | undefined,
  rulesetId: string,
): RecommendationCatalogItemV1 {
  const normalizedSlot = normalizeSlotType(raw.slotType);
  const activeItem = typeof raw.isActiveItem === 'boolean' ? raw.isActiveItem : undefined;
  const availabilityActive = typeof raw.active === 'boolean' ? raw.active : undefined;
  const shopable = typeof raw.shopable === 'boolean' ? raw.shopable : undefined;
  const disabled = typeof raw.disabled === 'boolean' ? raw.disabled : undefined;
  const rulesetAvailable = availabilityActive !== undefined && disabled !== undefined
    ? reconstructedFact(availabilityActive && !disabled, `catalog:${rulesetId}:active+disabled`)
    : unknownFact<boolean>(`catalog:${rulesetId}:availability`);
  const directPurchaseCost = Number.isFinite(raw.cost) && (raw.cost as number) >= 0
    ? observedFact(raw.cost as number, 'item_catalog_items.cost')
    : unknownFact<number>('item_catalog_items.cost');

  const sortedEdges = [...recipeEdges].sort((a, b) => {
    const orderA = a.componentOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.componentOrder ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB || a.componentItemId - b.componentItemId;
  });
  const recipeId = sortedEdges.length > 0 ? `upgrade:${raw.itemId}` : undefined;
  const enrichmentCost = recipeId
    ? mechanics?.upgradeRecipeCosts?.find((entry) => entry.recipeId === recipeId)?.soulsCost
    : undefined;
  const upgradeRecipes: CatalogUpgradeRecipeV1[] = recipeId
    ? [{
        recipeId,
        consumedItemIds: sortedEdges.map((edge) => edge.componentItemId),
        soulsCost: enrichmentCost ?? unknownFact<number>('upgrade-transaction-cost-unverified'),
      }]
    : [];

  return {
    itemId: raw.itemId,
    name: raw.name,
    className: raw.className,
    slotType: normalizedSlot
      ? observedFact(normalizedSlot, 'item_catalog_items.slotType')
      : unknownFact<InventorySlotType>('item_catalog_items.slotType'),
    activeItem: activeItem !== undefined
      ? observedFact(activeItem, 'item_catalog_items.isActiveItem')
      : unknownFact<boolean>('item_catalog_items.isActiveItem'),
    rulesetAvailable,
    shopable: shopable !== undefined
      ? observedFact(shopable, 'item_catalog_items.shopable')
      : unknownFact<boolean>('item_catalog_items.shopable'),
    disabled: disabled !== undefined
      ? observedFact(disabled, 'item_catalog_items.disabled')
      : unknownFact<boolean>('item_catalog_items.disabled'),
    directPurchaseCost,
    upgradeRecipes,
    sellTransition: mechanics?.sellTransition ?? {
      soulsRefund: unknownFact<number>('sell-refund-unverified'),
      returnedItemIds: unknownFact<readonly number[]>('sell-return-items-unverified'),
    },
    maxCopies: mechanics?.maxCopies ?? unknownFact<number>('duplicate-policy-unverified'),
  };
}

function calculateCoverage(items: readonly RecommendationCatalogItemV1[]): RecommendationRulesetCatalogCoverageV1 {
  const count = (predicate: (item: RecommendationCatalogItemV1) => boolean) => items.filter(predicate).length;
  const strictCompilable = (item: RecommendationCatalogItemV1) =>
    hasValue(item.slotType) && hasValue(item.activeItem) && hasValue(item.rulesetAvailable) && hasValue(item.shopable) && hasValue(item.disabled);
  return {
    totalItems: items.length,
    candidateItems: count((item) => item.rulesetAvailable.value === true),
    slotTypeKnown: count((item) => hasValue(item.slotType)),
    activeItemKnown: count((item) => hasValue(item.activeItem)),
    directPurchaseCostKnown: count((item) => hasValue(item.directPurchaseCost)),
    upgradeRecipeTopologyKnown: count((item) => item.upgradeRecipes.length > 0),
    upgradeTransactionCostKnown: count((item) => item.upgradeRecipes.some((recipe) => hasValue(recipe.soulsCost))),
    sellTransitionKnown: count((item) => hasValue(item.sellTransition.soulsRefund) && hasValue(item.sellTransition.returnedItemIds)),
    rulesetAvailabilityKnown: count((item) => hasValue(item.rulesetAvailable)),
    strictCompilableItems: count(strictCompilable),
  };
}

function canonicalRulesetId(version: RawCatalogVersionV1): string {
  const id = version.rulesetKey ?? version.rulesetId ?? version.clientVersion;
  if (!id) throw new Error('rulesetKey, rulesetId or clientVersion is required');
  return id;
}

function normalizeSlotType(slotType: string | undefined): InventorySlotType | undefined {
  const normalized = slotType?.trim().toLowerCase();
  if (normalized === 'weapon' || normalized === 'vitality' || normalized === 'spirit') return normalized;
  return undefined;
}

function hasValue<T>(fact: ObservedFact<T>): fact is ObservedFact<T> & { value: T; evidence: Exclude<FactEvidence, 'UNKNOWN'> } {
  return fact.evidence !== 'UNKNOWN' && fact.value !== undefined;
}
