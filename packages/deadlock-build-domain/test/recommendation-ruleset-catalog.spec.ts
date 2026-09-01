import {
  buildRecommendationRulesetCatalogV1,
  compileStrictRecommendationCatalogV1,
  observedFact,
} from '../src';

function baseInput() {
  return {
    version: {
      catalogVersionId: 'catalog-1',
      clientVersion: 'client-1',
      rulesetKey: 'ruleset-1',
      source: 'TEST',
      payloadSha256: 'a'.repeat(64),
    },
    items: [
      {
        itemId: 1,
        name: 'Component',
        slotType: 'weapon',
        cost: 800,
        shopable: true,
        disabled: false,
        active: true,
        isActiveItem: false,
      },
      {
        itemId: 2,
        name: 'Upgrade',
        slotType: 'weapon',
        cost: 1600,
        shopable: true,
        disabled: false,
        active: true,
        isActiveItem: false,
      },
    ],
    recipeEdges: [{ parentItemId: 2, componentItemId: 1, componentOrder: 0 }],
  } as const;
}

describe('recommendation ruleset catalog', () => {
  it('preserves version provenance and compiles known direct purchase costs', () => {
    const catalog = buildRecommendationRulesetCatalogV1(baseInput());
    const compiled = compileStrictRecommendationCatalogV1(catalog);

    expect(catalog.catalogVersionId).toBe('catalog-1');
    expect(catalog.rulesetId).toBe('ruleset-1');
    expect(catalog.payloadSha256).toBe('a'.repeat(64));
    expect(compiled.graph.getItem(1)?.directPurchaseCost).toBe(800);
    expect(compiled.graph.getItem(1)?.availableRulesetIds).toEqual(['ruleset-1']);
  });

  it('does not confuse catalog availability with active-item behavior', () => {
    const input = baseInput();
    const catalog = buildRecommendationRulesetCatalogV1({
      ...input,
      items: [{ ...input.items[0], active: false, isActiveItem: true }, input.items[1]],
    });
    const first = catalog.items.find((item) => item.itemId === 1)!;

    expect(first.activeItem.value).toBe(true);
    expect(first.rulesetAvailable.value).toBe(false);
  });

  it('excludes items when slot semantics are unknown', () => {
    const input = baseInput();
    const catalog = buildRecommendationRulesetCatalogV1({
      ...input,
      items: [{ ...input.items[0], slotType: undefined }, input.items[1]],
    });
    const compiled = compileStrictRecommendationCatalogV1(catalog);

    expect(compiled.excludedItemIds).toContain(1);
    expect(compiled.graph.getItem(1)).toBeUndefined();
  });

  it('keeps recipe topology but omits UPGRADE when transaction cost is unverified', () => {
    const catalog = buildRecommendationRulesetCatalogV1(baseInput());
    expect(catalog.items.find((item) => item.itemId === 2)?.upgradeRecipes).toHaveLength(1);
    expect(catalog.items.find((item) => item.itemId === 2)?.upgradeRecipes[0].soulsCost.evidence).toBe('UNKNOWN');

    const compiled = compileStrictRecommendationCatalogV1(catalog);
    expect(compiled.graph.getItem(2)?.upgradeRecipes).toEqual([]);
  });

  it('compiles exact upgrade and sell mechanics only when enriched with provenance', () => {
    const input = baseInput();
    const catalog = buildRecommendationRulesetCatalogV1({
      ...input,
      mechanics: [
        {
          itemId: 2,
          upgradeRecipeCosts: [
            {
              recipeId: 'upgrade:2',
              soulsCost: observedFact(800, 'controlled-ruleset-extractor'),
            },
          ],
          sellTransition: {
            soulsRefund: observedFact(800, 'controlled-ruleset-extractor'),
            returnedItemIds: observedFact([1], 'controlled-ruleset-extractor'),
          },
          maxCopies: observedFact(1, 'controlled-ruleset-extractor'),
        },
      ],
    });
    const compiled = compileStrictRecommendationCatalogV1(catalog);

    expect(compiled.graph.getItem(2)?.upgradeRecipes).toEqual([
      { recipeId: 'upgrade:2', consumedItemIds: [1], soulsCost: 800 },
    ]);
    expect(compiled.graph.getItem(2)?.sellTransition).toEqual({ soulsRefund: 800, returnedItemIds: [1] });
    expect(compiled.graph.getItem(2)?.maxCopies).toBe(1);
  });

  it('reports mechanic coverage without pretending unknown facts are known', () => {
    const catalog = buildRecommendationRulesetCatalogV1(baseInput());

    expect(catalog.coverage).toMatchObject({
      totalItems: 2,
      candidateItems: 2,
      slotTypeKnown: 2,
      activeItemKnown: 2,
      directPurchaseCostKnown: 2,
      upgradeRecipeTopologyKnown: 1,
      upgradeTransactionCostKnown: 0,
      sellTransitionKnown: 0,
      rulesetAvailabilityKnown: 2,
      strictCompilableItems: 2,
    });
  });

  it('rejects recipe references to missing catalog items', () => {
    const input = baseInput();
    expect(() => buildRecommendationRulesetCatalogV1({
      ...input,
      recipeEdges: [{ parentItemId: 2, componentItemId: 999, componentOrder: 0 }],
    })).toThrow('Recipe component 999 does not exist');
  });

  it('is deterministic when source item and recipe order changes', () => {
    const input = baseInput();
    const a = buildRecommendationRulesetCatalogV1(input);
    const b = buildRecommendationRulesetCatalogV1({
      ...input,
      items: [...input.items].reverse(),
      recipeEdges: [...input.recipeEdges].reverse(),
    });

    expect(b).toEqual(a);
  });
});
