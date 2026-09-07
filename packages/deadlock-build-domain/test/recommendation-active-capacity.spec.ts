import {
  RecommendationCandidateGeneratorRules,
  RecommendationDecisionState,
  RecommendationItemDefinition,
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  generateRecommendationCandidates,
  observedFact,
} from '../src';

function item(itemId: number, active: boolean): RecommendationItemDefinition {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon',
    active,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    maxCopies: 1,
  };
}

function state(definitions: readonly RecommendationItemDefinition[], held: readonly number[]): {
  state: RecommendationDecisionState;
  graph: ReturnType<typeof createRecommendationItemGraph>;
} {
  const graph = createRecommendationItemGraph(definitions);
  const heldByItemId = buildInventoryInstancesForRecommendation(held, graph);
  return {
    graph,
    state: {
      decisionId: 'd1',
      matchId: 'm1',
      playerSlot: 0,
      gameTimeSec: 100,
      rulesetId: 'r1',
      heroId: 1,
      inventory: {
        initializedFromSnapshot: true,
        heldByItemId,
        lifecycleCountByItemId: new Map(held.map((itemId) => [itemId, 1])),
        nextInstanceSequence: heldByItemId.size + 1,
      },
      economy: {
        spendableSouls: observedFact(5000, 'test'),
        shopOpportunity: observedFact('AVAILABLE' as const, 'test'),
      },
    },
  };
}

function rules(activeCapacityEvidence: 'RECONSTRUCTED' | 'UNKNOWN', maxActiveItems: number): RecommendationCandidateGeneratorRules {
  return {
    baseSlotsByType: { weapon: 10, vitality: 10, spirit: 10 },
    maxFlexSlots: 0,
    unlockedFlexSlots: 0,
    flexCapacityEvidence: 'OBSERVED',
    maxActiveItems,
    activeCapacityEvidence,
    allowSellOnlyActions: true,
    generateTargetedWaitActions: true,
  } as RecommendationCandidateGeneratorRules;
}

describe('recommendation active-item capacity evidence', () => {
  it('fails closed when an action would increase active usage but active capacity is unknown', () => {
    const input = state([item(1, true)], []);
    const candidate = generateRecommendationCandidates({
      state: input.state,
      itemGraph: input.graph,
      rules: rules('UNKNOWN', 0),
    }).find((entry) => entry.actionId === 'BUY_ITEM:1');

    expect(candidate?.feasible).toBe(false);
    expect(candidate?.reasons).toContain('ACTIVE_ITEM_CAPACITY_UNKNOWN');
    expect(candidate?.reasons).not.toContain('ACTIVE_ITEM_LIMIT_EXCEEDED');
  });

  it('does not block an unrelated non-active transaction merely because current active usage exceeds an unknown numeric fallback', () => {
    const input = state([item(1, true), item(2, false)], [1]);
    const candidate = generateRecommendationCandidates({
      state: input.state,
      itemGraph: input.graph,
      rules: rules('UNKNOWN', 0),
    }).find((entry) => entry.actionId === 'BUY_ITEM:2');

    expect(candidate?.reasons).not.toContain('ACTIVE_ITEM_CAPACITY_UNKNOWN');
    expect(candidate?.reasons).not.toContain('ACTIVE_ITEM_LIMIT_EXCEEDED');
    expect(candidate?.feasible).toBe(true);
  });

  it('enforces the exact active limit when mechanics are reconstructed', () => {
    const input = state([item(1, true), item(2, true)], [1]);
    const candidate = generateRecommendationCandidates({
      state: input.state,
      itemGraph: input.graph,
      rules: rules('RECONSTRUCTED', 1),
    }).find((entry) => entry.actionId === 'BUY_ITEM:2');

    expect(candidate?.reasons).toContain('ACTIVE_ITEM_LIMIT_EXCEEDED');
  });
});
