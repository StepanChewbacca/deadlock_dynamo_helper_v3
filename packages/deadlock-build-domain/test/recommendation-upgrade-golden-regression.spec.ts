import {
  RecommendationCandidateGeneratorRules,
  RecommendationDecisionState,
  RecommendationItemDefinition,
  applyRecommendationCandidateTransitionV1,
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  generateRecommendationCandidates,
  observedFact,
  resolveUpgradeExecutionPathV1,
} from '../src';

const CLOSE_QUARTERS = 101;
const POINT_BLANK = 102;
const ESCALATING_RESILIENCE = 103;
const UNRELATED_WEAPON = 199;

function item(
  itemId: number,
  name: string,
  slotType: 'weapon' | 'vitality' | 'spirit',
  overrides: Partial<RecommendationItemDefinition> = {},
): RecommendationItemDefinition {
  return {
    itemId,
    name,
    slotType,
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    maxCopies: 1,
    ...overrides,
  };
}

function rules(): RecommendationCandidateGeneratorRules {
  return {
    baseSlotsByType: { weapon: 2, vitality: 1, spirit: 0 },
    maxFlexSlots: 0,
    unlockedFlexSlots: 0,
    flexCapacityEvidence: 'OBSERVED',
    maxActiveItems: 1,
    activeCapacityEvidence: 'RECONSTRUCTED',
    allowSellOnlyActions: true,
    generateTargetedWaitActions: true,
  };
}

function fixture() {
  const graph = createRecommendationItemGraph([
    item(CLOSE_QUARTERS, 'Close Quarters', 'weapon'),
    item(POINT_BLANK, 'Point Blank', 'weapon', {
      directPurchaseCost: 3200,
      upgradeRecipes: [{
        recipeId: 'close-quarters-to-point-blank',
        consumedItemIds: [CLOSE_QUARTERS],
        soulsCost: 1600,
      }],
    }),
    item(ESCALATING_RESILIENCE, 'Escalating Resilience', 'vitality', {
      directPurchaseCost: 1600,
    }),
    item(UNRELATED_WEAPON, 'Unrelated Weapon', 'weapon'),
  ]);
  const heldByItemId = buildInventoryInstancesForRecommendation(
    [CLOSE_QUARTERS, UNRELATED_WEAPON],
    graph,
  );
  const state: RecommendationDecisionState = {
    decisionId: 'golden-upgrade',
    matchId: 'match-1',
    playerSlot: 0,
    gameTimeSec: 900,
    rulesetId: 'r1',
    heroId: 1,
    inventory: {
      initializedFromSnapshot: true,
      heldByItemId,
      lifecycleCountByItemId: new Map([
        [CLOSE_QUARTERS, 1],
        [UNRELATED_WEAPON, 1],
      ]),
      nextInstanceSequence: 3,
    },
    economy: {
      spendableSouls: observedFact(5000, 'test'),
      shopOpportunity: observedFact('AVAILABLE' as const, 'test'),
    },
  };
  return { graph, state };
}

describe('upgrade lineage golden regression', () => {
  it('upgrades Close Quarters into Point Blank without selling an unrelated full-slot item and never resurrects the consumed component', () => {
    const { graph, state } = fixture();
    const acquisition = resolveUpgradeExecutionPathV1(state, POINT_BLANK, graph);
    expect(acquisition).toMatchObject({
      kind: 'DIRECT_UPGRADE',
      targetItemId: POINT_BLANK,
      recipeId: 'close-quarters-to-point-blank',
    });

    const candidates = generateRecommendationCandidates({ state, itemGraph: graph, rules: rules() });
    const upgrade = candidates.find((candidate) =>
      candidate.actionId === 'UPGRADE_ITEM:102:close-quarters-to-point-blank',
    );
    const unrelatedReplacement = candidates.find((candidate) =>
      candidate.actionId === 'REPLACE_ITEM:199->102',
    );

    expect(upgrade).toMatchObject({
      feasible: true,
      recommendationEligible: true,
      resultingItemIds: [POINT_BLANK, UNRELATED_WEAPON],
    });
    expect(unrelatedReplacement).toMatchObject({
      feasible: true,
      recommendationEligible: false,
      recommendationSuppressionReasons: expect.arrayContaining(['OWNED_COMPONENT_REQUIRES_UPGRADE_PATH']),
    });

    const transitioned = applyRecommendationCandidateTransitionV1(state, upgrade!, graph);
    expect(transitioned.consumedItemIds).toEqual([CLOSE_QUARTERS]);
    expect(transitioned.removedItemIds).toEqual([CLOSE_QUARTERS]);
    expect(transitioned.addedItemIds).toEqual([POINT_BLANK]);
    expect([...transitioned.state.inventory.heldByItemId.keys()].sort((a, b) => a - b)).toEqual([
      POINT_BLANK,
      UNRELATED_WEAPON,
    ]);

    const nextCandidates = generateRecommendationCandidates({
      state: transitioned.state,
      itemGraph: graph,
      rules: rules(),
    });
    expect(nextCandidates.some((candidate) => candidate.actionId === `SELL_ITEM:${CLOSE_QUARTERS}`)).toBe(false);
    expect(nextCandidates.find((candidate) => candidate.actionId === `BUY_ITEM:${ESCALATING_RESILIENCE}`))
      .toMatchObject({ feasible: true, recommendationEligible: true });
  });
});
