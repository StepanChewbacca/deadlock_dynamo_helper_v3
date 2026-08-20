import { InventoryRuleset, InventorySlotType } from './types';

export const RULESET_CATALOG_SCHEMA_VERSION = 1 as const;

export interface RulesetCatalogItemV1 {
  itemId: number;
  slotType: InventorySlotType;
  cost: number;
  tier: number;
  shopable: boolean;
  disabled: boolean;
  active: boolean;
  sellValue?: number;
}

export interface RulesetCatalogRecipeV1 {
  parentItemId: number;
  componentItemIds: number[];
}

export interface RulesetCatalogInputV1 {
  rulesetKey: string;
  clientVersion: string;
  source: string;
  inventoryRuleset: InventoryRuleset;
  items: RulesetCatalogItemV1[];
  recipes: RulesetCatalogRecipeV1[];
}

export interface CanonicalRulesetCatalogV1 {
  schemaVersion: typeof RULESET_CATALOG_SCHEMA_VERSION;
  rulesetKey: string;
  clientVersion: string;
  source: string;
  inventoryRuleset: {
    duplicateItemsAllowed: boolean;
    baseSlotsByType: Record<InventorySlotType, number>;
    maxFlexSlots: number;
  };
  items: RulesetCatalogItemV1[];
  recipes: RulesetCatalogRecipeV1[];
}

export type RulesetCatalogValidationCode =
  | 'INVALID_RULESET_KEY'
  | 'INVALID_CLIENT_VERSION'
  | 'INVALID_SOURCE'
  | 'INVALID_SLOT_RULE'
  | 'INVALID_ITEM_ID'
  | 'INVALID_SLOT_TYPE'
  | 'DUPLICATE_ITEM_ID'
  | 'INVALID_ITEM_COST'
  | 'INVALID_ITEM_TIER'
  | 'INVALID_SELL_VALUE'
  | 'INVALID_RECIPE_PARENT'
  | 'DUPLICATE_RECIPE_PARENT'
  | 'RECIPE_PARENT_NOT_IN_CATALOG'
  | 'INVALID_RECIPE_COMPONENT'
  | 'RECIPE_COMPONENT_NOT_IN_CATALOG'
  | 'RECIPE_SELF_CYCLE'
  | 'RECIPE_GRAPH_CYCLE';

export class RulesetCatalogValidationError extends Error {
  constructor(
    public readonly code: RulesetCatalogValidationCode,
    message: string,
    public readonly itemIds: readonly number[] = [],
  ) {
    super(message);
    this.name = 'RulesetCatalogValidationError';
  }
}

export function canonicalizeRulesetCatalogV1(
  input: RulesetCatalogInputV1,
): CanonicalRulesetCatalogV1 {
  validateIdentity(input);
  validateInventoryRuleset(input.inventoryRuleset);

  const items = input.items.map((item) => normalizeItem(item));
  const itemIds = new Set<number>();
  for (const item of items) {
    if (itemIds.has(item.itemId)) {
      throw new RulesetCatalogValidationError(
        'DUPLICATE_ITEM_ID',
        `Duplicate item id ${item.itemId} in ruleset catalog.`,
        [item.itemId],
      );
    }
    itemIds.add(item.itemId);
  }
  items.sort((left, right) => left.itemId - right.itemId);

  const recipeParents = new Set<number>();
  const recipes = input.recipes.map((recipe) => {
    if (!isPositiveInteger(recipe.parentItemId)) {
      throw new RulesetCatalogValidationError(
        'INVALID_RECIPE_PARENT',
        `Recipe parent item id must be a positive integer: ${String(recipe.parentItemId)}.`,
      );
    }
    if (recipeParents.has(recipe.parentItemId)) {
      throw new RulesetCatalogValidationError(
        'DUPLICATE_RECIPE_PARENT',
        `Duplicate recipe definition for parent item ${recipe.parentItemId}.`,
        [recipe.parentItemId],
      );
    }
    recipeParents.add(recipe.parentItemId);
    if (!itemIds.has(recipe.parentItemId)) {
      throw new RulesetCatalogValidationError(
        'RECIPE_PARENT_NOT_IN_CATALOG',
        `Recipe parent item ${recipe.parentItemId} is not present in the item catalog.`,
        [recipe.parentItemId],
      );
    }

    const componentItemIds = recipe.componentItemIds.map((componentItemId) => {
      if (!isPositiveInteger(componentItemId)) {
        throw new RulesetCatalogValidationError(
          'INVALID_RECIPE_COMPONENT',
          `Recipe component item id must be a positive integer: ${String(componentItemId)}.`,
          [recipe.parentItemId],
        );
      }
      if (!itemIds.has(componentItemId)) {
        throw new RulesetCatalogValidationError(
          'RECIPE_COMPONENT_NOT_IN_CATALOG',
          `Recipe component item ${componentItemId} is not present in the item catalog.`,
          [recipe.parentItemId, componentItemId],
        );
      }
      if (componentItemId === recipe.parentItemId) {
        throw new RulesetCatalogValidationError(
          'RECIPE_SELF_CYCLE',
          `Recipe item ${recipe.parentItemId} cannot consume itself.`,
          [recipe.parentItemId],
        );
      }
      return componentItemId;
    });

    componentItemIds.sort((left, right) => left - right);
    return {
      parentItemId: recipe.parentItemId,
      componentItemIds,
    };
  });
  recipes.sort((left, right) => left.parentItemId - right.parentItemId);
  assertAcyclicRecipeGraph(recipes);

  return {
    schemaVersion: RULESET_CATALOG_SCHEMA_VERSION,
    rulesetKey: input.rulesetKey.trim(),
    clientVersion: input.clientVersion.trim(),
    source: input.source.trim(),
    inventoryRuleset: {
      duplicateItemsAllowed: input.inventoryRuleset.duplicateItemsAllowed,
      baseSlotsByType: {
        weapon: input.inventoryRuleset.baseSlotsByType.weapon,
        vitality: input.inventoryRuleset.baseSlotsByType.vitality,
        spirit: input.inventoryRuleset.baseSlotsByType.spirit,
      },
      maxFlexSlots: input.inventoryRuleset.maxFlexSlots,
    },
    items,
    recipes,
  };
}

export function canonicalRulesetCatalogJsonV1(input: RulesetCatalogInputV1): string {
  return JSON.stringify(canonicalizeRulesetCatalogV1(input));
}

function validateIdentity(input: RulesetCatalogInputV1): void {
  if (!input.rulesetKey?.trim()) {
    throw new RulesetCatalogValidationError('INVALID_RULESET_KEY', 'rulesetKey is required.');
  }
  if (!input.clientVersion?.trim()) {
    throw new RulesetCatalogValidationError('INVALID_CLIENT_VERSION', 'clientVersion is required.');
  }
  if (!input.source?.trim()) {
    throw new RulesetCatalogValidationError('INVALID_SOURCE', 'source is required.');
  }
}

function validateInventoryRuleset(ruleset: InventoryRuleset): void {
  const slotValues = [
    ruleset.baseSlotsByType.weapon,
    ruleset.baseSlotsByType.vitality,
    ruleset.baseSlotsByType.spirit,
    ruleset.maxFlexSlots,
  ];
  if (slotValues.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new RulesetCatalogValidationError(
      'INVALID_SLOT_RULE',
      'Inventory slot limits must be non-negative integers.',
    );
  }
}

function normalizeItem(item: RulesetCatalogItemV1): RulesetCatalogItemV1 {
  if (!isPositiveInteger(item.itemId)) {
    throw new RulesetCatalogValidationError(
      'INVALID_ITEM_ID',
      `Item id must be a positive integer: ${String(item.itemId)}.`,
    );
  }
  if (!isInventorySlotType(item.slotType)) {
    throw new RulesetCatalogValidationError(
      'INVALID_SLOT_TYPE',
      `Item ${item.itemId} has invalid slot type ${String(item.slotType)}.`,
      [item.itemId],
    );
  }
  if (!Number.isInteger(item.cost) || item.cost < 0) {
    throw new RulesetCatalogValidationError(
      'INVALID_ITEM_COST',
      `Item ${item.itemId} has invalid cost ${String(item.cost)}.`,
      [item.itemId],
    );
  }
  if (!Number.isInteger(item.tier) || item.tier < 0) {
    throw new RulesetCatalogValidationError(
      'INVALID_ITEM_TIER',
      `Item ${item.itemId} has invalid tier ${String(item.tier)}.`,
      [item.itemId],
    );
  }
  if (item.sellValue !== undefined && (!Number.isInteger(item.sellValue) || item.sellValue < 0)) {
    throw new RulesetCatalogValidationError(
      'INVALID_SELL_VALUE',
      `Item ${item.itemId} has invalid sell value ${String(item.sellValue)}.`,
      [item.itemId],
    );
  }

  return {
    itemId: item.itemId,
    slotType: item.slotType,
    cost: item.cost,
    tier: item.tier,
    shopable: item.shopable,
    disabled: item.disabled,
    active: item.active,
    ...(item.sellValue === undefined ? {} : { sellValue: item.sellValue }),
  };
}

function assertAcyclicRecipeGraph(recipes: readonly RulesetCatalogRecipeV1[]): void {
  const componentsByParent = new Map<number, readonly number[]>(
    recipes.map((recipe) => [recipe.parentItemId, recipe.componentItemIds]),
  );
  const visiting = new Set<number>();
  const visited = new Set<number>();

  const visit = (itemId: number, path: number[]): void => {
    if (visiting.has(itemId)) {
      const cycleStart = path.indexOf(itemId);
      const cycle = [...path.slice(Math.max(cycleStart, 0)), itemId];
      throw new RulesetCatalogValidationError(
        'RECIPE_GRAPH_CYCLE',
        `Recipe graph cycle detected: ${cycle.join(' -> ')}.`,
        cycle,
      );
    }
    if (visited.has(itemId)) return;

    visiting.add(itemId);
    for (const componentItemId of componentsByParent.get(itemId) ?? []) {
      if (componentsByParent.has(componentItemId)) {
        visit(componentItemId, [...path, itemId]);
      }
    }
    visiting.delete(itemId);
    visited.add(itemId);
  };

  for (const recipe of recipes) {
    visit(recipe.parentItemId, []);
  }
}

function isInventorySlotType(value: unknown): value is InventorySlotType {
  return value === 'weapon' || value === 'vitality' || value === 'spirit';
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
