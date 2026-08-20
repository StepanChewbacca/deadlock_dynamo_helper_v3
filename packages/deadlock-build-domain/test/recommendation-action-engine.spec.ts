import {
  applyInventoryAction,
  createEmptyInventoryState,
  createRecipeGraph,
  generateLegalRecommendationActions,
  InventoryRuleset,
  RecommendationCatalogItem,
  RecommendationExactEconomy,
  recommendationActionId,
  simulateRecommendationAction,
} from '../src';

const metadata = {
  observedAtMs: 1,
  gameTimeSec: 300,
  evidence: 'DERIVED' as const,
  source: 'SYSTEM' as const,
};

const strictRuleset: InventoryRuleset = {
  duplicateItemsAllowed: false,
  baseSlotsByType: {
    weapon: 1,
    vitality: 1,
    spirit: 1,
  },
  maxFlexSlots: 0,
};

const catalog: RecommendationCatalogItem[] = [
  item(100, 'weapon', 500, 1),
  item(101, 'weapon', 500, 1),
  item(200, 'spirit', 1250, 2),
  item(300, 'spirit', 3000, 3),
  { ...item(400, 'vitality', 500, 1), disabled: true, active: false },
];

function item(
  itemId: number,
  slotType: RecommendationCatalogItem['slotType'],
  cost: number,
  tier: number,
): RecommendationCatalogItem {
  return {
    itemId,
    slotType,
    cost,
    tier,
    shopable: true,
    disabled: false,
    active: true,
  };
}

function exactEconomy(spendableSouls: number): RecommendationExactEconomy {
  return {
    spendableSouls,
    buyCostByItemId: new Map([
      [100, 500],
      [101, 500],
      [200, 1250],
      [400, 500],
    ]),
    upgradeCostByItemId: new Map([[300, 1750]]),
    sellRefundByItemId: new Map([
      [100, 250],
      [101, 250],
      [200, 625],
      [300, 1500],
    ]),
  };
}

function ownedState(...ownedItems: RecommendationCatalogItem[]) {
  let state = createEmptyInventoryState();
  for (const ownedItem of ownedItems) {
    const result = applyInventoryAction(
      state,
      { type: 'BUY', item: ownedItem, metadata },
      { recipeGraph: createRecipeGraph([]), ruleset: strictRuleset },
    );
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }
  return state;
}

describe('generateLegalRecommendationActions', () => {
  it('fails closed to WAIT when validated spendable currency is unavailable', () => {
    const result = generateLegalRecommendationActions({
      state: createEmptyInventoryState(),
      catalogItems: catalog,
      recipeGraph: createRecipeGraph([{ parentItemId: 300, componentItemIds: [200] }]),
      ruleset: strictRuleset,
      observedAtMs: 10,
    });

    expect(result.candidates.map((candidate) => candidate.actionId)).toEqual(['WAIT']);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'INVALID_SPENDABLE_SOULS' })]),
    );
  });

  it('emits affordable base BUY actions and never emits disabled items', () => {
    const result = generateLegalRecommendationActions({
      state: createEmptyInventoryState(),
      catalogItems: catalog,
      recipeGraph: createRecipeGraph([{ parentItemId: 300, componentItemIds: [200] }]),
      ruleset: strictRuleset,
      economy: exactEconomy(600),
      observedAtMs: 10,
    });

    expect(actionIds(result)).toContain('BUY:100');
    expect(actionIds(result)).toContain('BUY:101');
    expect(actionIds(result)).not.toContain('BUY:200');
    expect(actionIds(result)).not.toContain('BUY:300');
    expect(actionIds(result)).not.toContain('BUY:400');
  });

  it('does not bypass recipe prerequisites with a direct BUY', () => {
    const result = generateLegalRecommendationActions({
      state: createEmptyInventoryState(),
      catalogItems: catalog,
      recipeGraph: createRecipeGraph([{ parentItemId: 300, componentItemIds: [200] }]),
      ruleset: strictRuleset,
      economy: exactEconomy(5000),
      observedAtMs: 10,
    });

    expect(actionIds(result)).not.toContain('BUY:300');
    expect(actionIds(result).some((actionId) => actionId.startsWith('UPGRADE:300:'))).toBe(false);
  });

  it('emits UPGRADE only when all direct components are held and affordable', () => {
    const recipeGraph = createRecipeGraph([{ parentItemId: 300, componentItemIds: [200] }]);
    const state = ownedState(catalog[2]);
    const result = generateLegalRecommendationActions({
      state,
      catalogItems: catalog,
      recipeGraph,
      ruleset: strictRuleset,
      economy: exactEconomy(1800),
      observedAtMs: 10,
    });

    expect(actionIds(result)).toContain('UPGRADE:300:200');
    const upgrade = result.candidates.find((candidate) => candidate.actionId === 'UPGRADE:300:200');
    expect(upgrade).toMatchObject({
      effectiveCost: 1750,
      soulsDelta: -1750,
      spendableSoulsAfter: 50,
    });
  });

  it('emits REPLACE when a full slot blocks BUY but sell plus buy is legal', () => {
    const state = ownedState(catalog[0]);
    const result = generateLegalRecommendationActions({
      state,
      catalogItems: catalog,
      recipeGraph: createRecipeGraph([]),
      ruleset: strictRuleset,
      economy: exactEconomy(300),
      observedAtMs: 10,
    });

    expect(actionIds(result)).not.toContain('BUY:101');
    expect(actionIds(result)).toContain('SELL:100');
    expect(actionIds(result)).toContain('REPLACE:100->101');
    expect(result.candidates.find((candidate) => candidate.actionId === 'REPLACE:100->101')).toMatchObject({
      effectiveCost: 250,
      soulsDelta: -250,
      spendableSoulsAfter: 50,
    });
  });

  it('never emits an unaffordable spend action', () => {
    const result = generateLegalRecommendationActions({
      state: createEmptyInventoryState(),
      catalogItems: catalog,
      recipeGraph: createRecipeGraph([]),
      ruleset: strictRuleset,
      economy: exactEconomy(499),
      observedAtMs: 10,
    });

    expect(actionIds(result).filter((actionId) => actionId.startsWith('BUY:'))).toEqual([]);
    expect(actionIds(result).filter((actionId) => actionId.startsWith('REPLACE:'))).toEqual([]);
  });

  it('guarantees every emitted action passes deterministic inventory simulation', () => {
    const state = ownedState(catalog[0], catalog[2]);
    const recipeGraph = createRecipeGraph([{ parentItemId: 300, componentItemIds: [200] }]);
    const result = generateLegalRecommendationActions({
      state,
      catalogItems: catalog,
      recipeGraph,
      ruleset: strictRuleset,
      economy: exactEconomy(5000),
      observedAtMs: 10,
    });
    const catalogByItemId = new Map(catalog.map((catalogItem) => [catalogItem.itemId, catalogItem]));

    for (const candidate of result.candidates) {
      expect(
        simulateRecommendationAction({
          state,
          action: candidate.action,
          catalogByItemId,
          recipeGraph,
          ruleset: strictRuleset,
          observedAtMs: 10,
        }),
      ).toMatchObject({ ok: true });
      expect(candidate.actionId).toBe(recommendationActionId(candidate.action));
    }
  });

  it('fails closed on recipes that require duplicate component instances', () => {
    const state = ownedState(catalog[2]);
    const result = generateLegalRecommendationActions({
      state,
      catalogItems: catalog,
      recipeGraph: createRecipeGraph([{ parentItemId: 300, componentItemIds: [200, 200] }]),
      ruleset: strictRuleset,
      economy: exactEconomy(5000),
      observedAtMs: 10,
    });

    expect(actionIds(result)).not.toContain('UPGRADE:300:200,200');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RECIPE_REQUIRES_DUPLICATE_COMPONENT_INSTANCE' }),
      ]),
    );
  });
});

function actionIds(result: ReturnType<typeof generateLegalRecommendationActions>): string[] {
  return result.candidates.map((candidate) => candidate.actionId);
}
