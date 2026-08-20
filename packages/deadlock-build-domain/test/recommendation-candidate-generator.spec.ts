import {
  DEFAULT_RECOMMENDATION_CANDIDATE_RULES,
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  generateRecommendationCandidates,
  observedFact,
  RecommendationDecisionState,
  RecommendationItemDefinition,
  toRecommendationDatasetCandidateV1,
  unknownFact,
} from '../src';

function item(itemId: number, overrides: Partial<RecommendationItemDefinition> = {}): RecommendationItemDefinition {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    maxCopies: 1,
    ...overrides,
  };
}

function decision(
  definitions: RecommendationItemDefinition[],
  held: number[] = [],
  souls = 3_000,
  options: { walletUnknown?: boolean; shop?: 'AVAILABLE' | 'UNAVAILABLE'; shopUnknown?: boolean } = {},
): { state: RecommendationDecisionState; graph: ReturnType<typeof createRecommendationItemGraph> } {
  const graph = createRecommendationItemGraph(definitions);
  return {
    graph,
    state: {
      decisionId: 'd1',
      matchId: 'm1',
      playerSlot: 1,
      gameTimeSec: 100,
      rulesetId: 'r1',
      heroId: 1,
      inventory: {
        initializedFromSnapshot: true,
        heldByItemId: buildInventoryInstancesForRecommendation(held, graph),
        lifecycleCountByItemId: new Map(),
        nextInstanceSequence: 1,
      },
      economy: {
        spendableSouls: options.walletUnknown ? unknownFact('test') : observedFact(souls, 'test'),
        netWorth: observedFact(99_999, 'net-worth'),
        shopOpportunity: options.shopUnknown
          ? unknownFact('shop')
          : observedFact(options.shop ?? 'AVAILABLE', 'shop'),
      },
    },
  };
}

function candidate(input: ReturnType<typeof decision>, actionId: string) {
  const result = generateRecommendationCandidates({ state: input.state, itemGraph: input.graph });
  const found = result.find((entry) => entry.actionId === actionId);
  expect(found).toBeDefined();
  return found!;
}

describe('recommendation candidate generator', () => {
  it('uses exact upgrade transaction cost, consumes components and reuses the slot', () => {
    const input = decision([
      item(1),
      item(2, { directPurchaseCost: 1_600, upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }] }),
    ], [1], 1_000);

    expect(candidate(input, 'UPGRADE_ITEM:2:u2')).toMatchObject({
      feasible: true,
      effectiveCostSouls: 800,
      spendableSoulsAfter: 200,
      resultingItemIds: [2],
    });
  });

  it('fails closed when exact spendable souls are unknown and never substitutes net worth', () => {
    const input = decision([item(1)], [], 0, { walletUnknown: true });
    const result = candidate(input, 'BUY_ITEM:1');
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('SPENDABLE_SOULS_UNKNOWN');
  });

  it('emits WAIT_SAVE when a legal target is unaffordable', () => {
    const input = decision([item(1, { directPurchaseCost: 1_600 })], [], 1_000);
    const candidates = generateRecommendationCandidates({ state: input.state, itemGraph: input.graph });
    expect(candidates.find((entry) => entry.actionId === 'BUY_ITEM:1')?.reasons).toContain('UNAFFORDABLE');
    expect(candidates.find((entry) => entry.actionId === 'WAIT_SAVE:1')?.feasible).toBe(true);
  });

  it('rejects a typed-slot overflow while allowing an economically feasible replacement', () => {
    const definitions = [1, 2, 3, 4, 5].map((id) => item(id));
    const input = decision(definitions, [1, 2, 3, 4], 5_000);
    const rules = { ...DEFAULT_RECOMMENDATION_CANDIDATE_RULES, maxFlexSlots: 0 };
    const candidates = generateRecommendationCandidates({ state: input.state, itemGraph: input.graph, rules });
    expect(candidates.find((entry) => entry.actionId === 'BUY_ITEM:5')?.reasons).toContain('SLOT_LIMIT_EXCEEDED');
    expect(candidates.find((entry) => entry.actionId === 'REPLACE_ITEM:1->5')?.feasible).toBe(true);
  });

  it('applies explicit returned components when selling an upgraded item', () => {
    const input = decision([
      item(1),
      item(2, { directPurchaseCost: 1_600, sellTransition: { soulsRefund: 800, returnedItemIds: [1] } }),
    ], [2], 100);

    expect(candidate(input, 'SELL_ITEM:2')).toMatchObject({
      feasible: true,
      spendableSoulsAfter: 900,
      resultingItemIds: [1],
    });
  });

  it('preserves the no observed-action injection invariant in dataset rows', () => {
    const input = decision([item(1)]);
    const row = toRecommendationDatasetCandidateV1(input.state, candidate(input, 'BUY_ITEM:1'));
    expect(row.observedActionInjected).toBe(false);
    expect(row.actionId).toBe('BUY_ITEM:1');
    expect(row.evidence.spendableSouls).toBe('OBSERVED');
  });

  it('is deterministic independent of item definition order', () => {
    const a = decision([item(1), item(2)], [1], 5_000);
    const b = decision([item(2), item(1)], [1], 5_000);
    expect(generateRecommendationCandidates({ state: a.state, itemGraph: a.graph }).map((entry) => entry.actionId))
      .toEqual(generateRecommendationCandidates({ state: b.state, itemGraph: b.graph }).map((entry) => entry.actionId));
  });
});
