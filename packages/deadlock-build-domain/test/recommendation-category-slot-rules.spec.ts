import {
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  generateRecommendationCandidates,
  observedFact,
  RecommendationCandidateGeneratorRules,
  RecommendationDecisionState,
  RecommendationItemDefinition,
} from '../src';

function item(itemId: number, slotType: RecommendationItemDefinition['slotType']): RecommendationItemDefinition {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType,
    active: false,
    availableRulesetIds: ['ruleset-current'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    maxCopies: 1,
  };
}

const definitions: RecommendationItemDefinition[] = [
  item(1, 'weapon'),
  item(2, 'weapon'),
  item(3, 'weapon'),
  item(4, 'weapon'),
  item(5, 'weapon'),
  item(10, 'vitality'),
  item(20, 'spirit'),
];

const graph = createRecommendationItemGraph(definitions);

function state(held: readonly number[]): RecommendationDecisionState {
  return {
    decisionId: 'category-slot-test',
    matchId: 'match',
    playerSlot: 0,
    gameTimeSec: 100,
    rulesetId: 'ruleset-current',
    heroId: 1,
    inventory: {
      initializedFromSnapshot: true,
      heldByItemId: buildInventoryInstancesForRecommendation(held, graph),
      lifecycleCountByItemId: new Map(held.map((itemId) => [itemId, 1])),
      nextInstanceSequence: held.length + 1,
    },
    economy: {
      spendableSouls: observedFact(10_000, 'test'),
      shopOpportunity: observedFact('AVAILABLE', 'test'),
    },
  };
}

function rules(unlockedFlexSlots: number): RecommendationCandidateGeneratorRules {
  return {
    baseSlots: 12,
    baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
    maxFlexSlots: 4,
    unlockedFlexSlots,
    flexCapacityEvidence: 'OBSERVED',
    maxActiveItems: 4,
    allowSellOnlyActions: true,
    generateTargetedWaitActions: true,
  };
}

describe('category-aware recommendation slot rules', () => {
  it('requires flex for a fifth weapon even when total inventory is below twelve items', () => {
    const candidates = generateRecommendationCandidates({
      state: state([1, 2, 3, 4]),
      itemGraph: graph,
      rules: rules(0),
    });

    const fifthWeapon = candidates.find((candidate) => candidate.actionId === 'BUY_ITEM:5');
    expect(fifthWeapon?.feasible).toBe(false);
    expect(fifthWeapon?.reasons).toContain('SLOT_LIMIT_EXCEEDED');
  });

  it('allows the fifth weapon after one flex slot is observed unlocked', () => {
    const candidates = generateRecommendationCandidates({
      state: state([1, 2, 3, 4]),
      itemGraph: graph,
      rules: rules(1),
    });

    expect(candidates.find((candidate) => candidate.actionId === 'BUY_ITEM:5')?.feasible).toBe(true);
  });

  it('counts overflow independently across item categories', () => {
    const candidates = generateRecommendationCandidates({
      state: state([1, 2, 3, 4, 10, 20]),
      itemGraph: graph,
      rules: rules(0),
    });

    expect(candidates.find((candidate) => candidate.actionId === 'BUY_ITEM:5')?.reasons)
      .toContain('SLOT_LIMIT_EXCEEDED');
  });
});
