import {
  DEFAULT_RECOMMENDATION_CANDIDATE_RULES,
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  generateRecommendationCandidates,
  observedFact,
  projectRecommendationCandidateState,
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
        lifecycleCountByItemId: new Map(held.map((itemId) => [itemId, 1])),
        nextInstanceSequence: held.length + 1,
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

  it('enforces four base slots per category even when total inventory is below twelve items', () => {
    const definitions = Array.from({ length: 5 }, (_, index) => item(index + 1, { slotType: 'weapon' }));
    const input = decision(definitions, [1, 2, 3, 4], 5_000);
    const rules = {
      ...DEFAULT_RECOMMENDATION_CANDIDATE_RULES,
      unlockedFlexSlots: 0,
      flexCapacityEvidence: 'OBSERVED' as const,
    };
    const candidates = generateRecommendationCandidates({ state: input.state, itemGraph: input.graph, rules });

    expect(candidates.find((entry) => entry.actionId === 'BUY_ITEM:5')?.reasons).toContain('SLOT_LIMIT_EXCEEDED');
    expect(candidates.find((entry) => entry.actionId === 'REPLACE_ITEM:1->5')?.feasible).toBe(true);
  });

  it('uses actual unlocked flex capacity instead of the ruleset maximum', () => {
    const definitions = Array.from({ length: 5 }, (_, index) => item(index + 1));
    const input = decision(definitions, [1, 2, 3, 4], 5_000);
    const lockedRules = {
      ...DEFAULT_RECOMMENDATION_CANDIDATE_RULES,
      unlockedFlexSlots: 0,
      flexCapacityEvidence: 'OBSERVED' as const,
    };
    const unlockedRules = {
      ...DEFAULT_RECOMMENDATION_CANDIDATE_RULES,
      unlockedFlexSlots: 1,
      flexCapacityEvidence: 'OBSERVED' as const,
    };

    const locked = generateRecommendationCandidates({ state: input.state, itemGraph: input.graph, rules: lockedRules });
    const unlocked = generateRecommendationCandidates({ state: input.state, itemGraph: input.graph, rules: unlockedRules });

    expect(locked.find((entry) => entry.actionId === 'BUY_ITEM:5')?.reasons).toContain('SLOT_LIMIT_EXCEEDED');
    expect(unlocked.find((entry) => entry.actionId === 'BUY_ITEM:5')?.feasible).toBe(true);
  });

  it('treats observed current category flex usage as a lower bound when capacity is unknown', () => {
    const definitions = Array.from({ length: 6 }, (_, index) => item(index + 1));
    const input = decision(definitions, [1, 2, 3, 4, 5], 5_000);
    const rules = {
      ...DEFAULT_RECOMMENDATION_CANDIDATE_RULES,
      flexCapacityEvidence: 'UNKNOWN' as const,
      unlockedFlexSlots: undefined,
    };
    const candidates = generateRecommendationCandidates({ state: input.state, itemGraph: input.graph, rules });

    expect(candidates.find((entry) => entry.actionId === 'BUY_ITEM:6')?.reasons)
      .toContain('FLEX_SLOT_CAPACITY_UNKNOWN');
    expect(candidates.find((entry) => entry.actionId === 'REPLACE_ITEM:1->6')?.feasible).toBe(true);
  });

  it('does not treat an unverified flex unlock count as capacity', () => {
    const definitions = Array.from({ length: 6 }, (_, index) => item(index + 1));
    const input = decision(definitions, [1, 2, 3, 4, 5], 5_000);
    const rules = {
      ...DEFAULT_RECOMMENDATION_CANDIDATE_RULES,
      flexCapacityEvidence: 'UNKNOWN' as const,
      unlockedFlexSlots: 4,
    };
    const candidates = generateRecommendationCandidates({ state: input.state, itemGraph: input.graph, rules });

    expect(candidates.find((entry) => entry.actionId === 'BUY_ITEM:6')?.reasons)
      .toContain('FLEX_SLOT_CAPACITY_UNKNOWN');
  });

  it('never allows more than four flex slots under the current fallback rules', () => {
    const definitions = Array.from({ length: 9 }, (_, index) => item(index + 1));
    const input = decision(definitions, [1, 2, 3, 4, 5, 6, 7, 8], 20_000);
    const rules = {
      ...DEFAULT_RECOMMENDATION_CANDIDATE_RULES,
      maxFlexSlots: 4,
      unlockedFlexSlots: 4,
      flexCapacityEvidence: 'OBSERVED' as const,
    };
    const candidates = generateRecommendationCandidates({ state: input.state, itemGraph: input.graph, rules });

    expect(candidates.find((entry) => entry.actionId === 'BUY_ITEM:9')?.reasons).toContain('SLOT_LIMIT_EXCEEDED');
  });

  it('requires a known shop opportunity for selling', () => {
    const unavailable = decision([item(1)], [1], 1_000, { shop: 'UNAVAILABLE' });
    expect(candidate(unavailable, 'SELL_ITEM:1')).toMatchObject({
      feasible: false,
      reasons: expect.arrayContaining(['SHOP_UNAVAILABLE']),
    });

    const unknown = decision([item(1)], [1], 1_000, { shopUnknown: true });
    expect(candidate(unknown, 'SELL_ITEM:1')).toMatchObject({
      feasible: false,
      reasons: expect.arrayContaining(['SHOP_OPPORTUNITY_UNKNOWN']),
    });
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

  it('projects the exact canonical candidate result into a future decision state', () => {
    const input = decision([
      item(1),
      item(2, { directPurchaseCost: 1_600, upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }] }),
    ], [1], 1_000);
    const upgrade = candidate(input, 'UPGRADE_ITEM:2:u2');
    const projected = projectRecommendationCandidateState(input.state, upgrade, input.graph);

    expect([...projected.inventory.heldByItemId.keys()]).toEqual([2]);
    expect(projected.inventory.heldByItemId.get(2)?.acquiredBy).toBe('UPGRADE');
    expect(projected.economy.spendableSouls.value).toBe(200);
    expect(projected.economy.spendableSouls.evidence).toBe('RECONSTRUCTED');
  });

  it('suppresses a lower component when an owned upgrade already satisfies it', () => {
    const input = decision([
      item(1),
      item(2, {
        directPurchaseCost: 1_600,
        upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }],
      }),
    ], [2], 5_000);

    expect(candidate(input, 'BUY_ITEM:1')).toMatchObject({
      feasible: true,
      recommendationEligible: false,
      recommendationSuppressionReasons: ['TARGET_SATISFIED_BY_OWNED_UPGRADE'],
    });
  });

  it('suppresses transitive lower components when a higher descendant is owned', () => {
    const input = decision([
      item(1),
      item(2, {
        directPurchaseCost: 1_600,
        upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }],
      }),
      item(3, {
        directPurchaseCost: 2_400,
        upgradeRecipes: [{ recipeId: 'u3', consumedItemIds: [2], soulsCost: 800 }],
      }),
    ], [3], 5_000);

    expect(candidate(input, 'BUY_ITEM:1').recommendationEligible).toBe(false);
    expect(candidate(input, 'BUY_ITEM:2').recommendationEligible).toBe(false);
  });

  it('does not emit targeted wait for a target already satisfied by an owned upgrade', () => {
    const input = decision([
      item(1, { directPurchaseCost: 6_400 }),
      item(2, {
        directPurchaseCost: 1_600,
        upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }],
      }),
    ], [2], 1_000);

    const candidates = generateRecommendationCandidates({ state: input.state, itemGraph: input.graph });
    expect(candidates.some((entry) => entry.actionId === 'WAIT_SAVE:1')).toBe(false);
  });

  it('suppresses a normal replacement that downgrades a descendant into its ancestor', () => {
    const input = decision([
      item(1),
      item(2, {
        directPurchaseCost: 1_600,
        upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }],
      }),
    ], [2], 5_000);

    expect(candidate(input, 'REPLACE_ITEM:2->1')).toMatchObject({
      feasible: true,
      recommendationEligible: false,
      recommendationSuppressionReasons: ['LINEAGE_DOWNGRADE'],
    });
  });

  it('keeps unrelated legal purchases recommendation-eligible', () => {
    const input = decision([item(1), item(2)], [2], 5_000);
    expect(candidate(input, 'BUY_ITEM:1')).toMatchObject({
      feasible: true,
      recommendationEligible: true,
      recommendationSuppressionReasons: [],
    });
  });

  it('preserves the no observed-action injection invariant in dataset rows', () => {
    const input = decision([item(1)]);
    const row = toRecommendationDatasetCandidateV1(input.state, candidate(input, 'BUY_ITEM:1'));
    expect(row.observedActionInjected).toBe(false);
    expect(row.actionId).toBe('BUY_ITEM:1');
    expect(row.evidence.spendableSouls).toBe('OBSERVED');
    expect('recommendationEligible' in row).toBe(false);
    expect('recommendationSuppressionReasons' in row).toBe(false);
  });

  it('is deterministic independent of item definition order', () => {
    const a = decision([item(1), item(2)], [1], 5_000);
    const b = decision([item(2), item(1)], [1], 5_000);
    expect(generateRecommendationCandidates({ state: a.state, itemGraph: a.graph }).map((entry) => entry.actionId))
      .toEqual(generateRecommendationCandidates({ state: b.state, itemGraph: b.graph }).map((entry) => entry.actionId));
  });
});
