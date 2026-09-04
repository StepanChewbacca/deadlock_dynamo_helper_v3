import {
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  generateRecommendationCandidates,
  observedFact,
  RecommendationCandidate,
  RecommendationCandidateGeneratorRules,
  RecommendationDecisionState,
} from '@deadlock-live-probe/build-domain';
import {
  RecommendationEconomyRulesV1,
  deriveAdaptiveInvestmentDeltasV1,
  deriveAdaptiveInvestmentStateV1,
  deriveAdaptiveSlotStateV1,
  resolveRecommendationEconomyRulesV1,
} from '../src/statlocker-adaptive/adaptive-economy-v1';
import {
  createAdaptivePlannerNodeV1,
  projectPlannerCandidateV1,
} from '../src/statlocker-adaptive/adaptive-planner-transition-v1';

const catalogSha256 = 'a'.repeat(64);
const rules: RecommendationEconomyRulesV1 = {
  rulesetId: 'ruleset-a',
  catalogSha256,
  baseSlots: 9,
  maxFlexSlots: 3,
  investmentBreakpoints: {
    weapon: [1600, 3200, 6400],
    vitality: [1600, 3200, 6400],
    spirit: [1600, 3200, 6400],
  },
};

const generatorRules: RecommendationCandidateGeneratorRules = {
  baseSlots: rules.baseSlots,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
  maxFlexSlots: rules.maxFlexSlots,
  unlockedFlexSlots: 3,
  flexCapacityEvidence: 'OBSERVED',
  maxActiveItems: 4,
  allowSellOnlyActions: true,
  generateTargetedWaitActions: true,
};

function graph() {
  return createRecommendationItemGraph([
    ...[1, 2, 3, 4, 5, 6].map((itemId) => ({
      itemId,
      name: `Weapon ${itemId}`,
      slotType: 'weapon' as const,
      active: false,
      availableRulesetIds: ['ruleset-a'],
      directPurchaseCost: 800,
      upgradeRecipes: [],
      sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    })),
    {
      itemId: 7,
      name: 'Weapon Upgrade',
      slotType: 'weapon' as const,
      active: false,
      availableRulesetIds: ['ruleset-a'],
      directPurchaseCost: 1600,
      upgradeRecipes: [{ recipeId: 'upgrade-7', consumedItemIds: [1], soulsCost: 800 }],
      sellTransition: { soulsRefund: 800, returnedItemIds: [1] },
    },
    {
      itemId: 8,
      name: 'Upgrade Only Weapon',
      slotType: 'weapon' as const,
      active: false,
      availableRulesetIds: ['ruleset-a'],
      upgradeRecipes: [{ recipeId: 'upgrade-8', consumedItemIds: [1], soulsCost: 800 }],
      sellTransition: { soulsRefund: 800, returnedItemIds: [1] },
    },
    {
      itemId: 9,
      name: 'Nested Upgrade Only Weapon',
      slotType: 'weapon' as const,
      active: false,
      availableRulesetIds: ['ruleset-a'],
      upgradeRecipes: [{ recipeId: 'upgrade-9', consumedItemIds: [8], soulsCost: 800 }],
      sellTransition: { soulsRefund: 1200, returnedItemIds: [8] },
    },
    ...[10, 11].map((itemId) => ({
      itemId,
      name: `Vitality ${itemId}`,
      slotType: 'vitality' as const,
      active: false,
      availableRulesetIds: ['ruleset-a'],
      directPurchaseCost: 1600,
      upgradeRecipes: [],
      sellTransition: { soulsRefund: 800, returnedItemIds: [] },
    })),
    ...[20, 21, 22].map((itemId) => ({
      itemId,
      name: `Spirit ${itemId}`,
      slotType: 'spirit' as const,
      active: false,
      availableRulesetIds: ['ruleset-a'],
      directPurchaseCost: 1600,
      upgradeRecipes: [],
      sellTransition: { soulsRefund: 800, returnedItemIds: [] },
    })),
  ]);
}

function decisionState(held: number[], wallet = 5000): RecommendationDecisionState {
  const itemGraph = graph();
  return {
    decisionId: 'decision',
    matchId: 'match',
    playerSlot: 0,
    gameTimeSec: 500,
    rulesetId: 'ruleset-a',
    heroId: 10,
    inventory: {
      initializedFromSnapshot: true,
      heldByItemId: buildInventoryInstancesForRecommendation(held, itemGraph),
      lifecycleCountByItemId: new Map(held.map((itemId) => [itemId, 1])),
      nextInstanceSequence: held.length + 1,
    },
    economy: {
      spendableSouls: observedFact(wallet, 'test'),
      shopOpportunity: observedFact('AVAILABLE', 'test'),
    },
  };
}

function plannerNode(held: number[], wallet = 5000) {
  const itemGraph = graph();
  const state = decisionState(held, wallet);
  return createAdaptivePlannerNodeV1({
    decisionState: state,
    slots: deriveAdaptiveSlotStateV1(held, itemGraph, rules, { unlockedFlexSlots: 3, evidence: 'OBSERVED' }),
    investment: deriveAdaptiveInvestmentStateV1(held, itemGraph, rules),
  });
}

function candidateFor(state: RecommendationDecisionState, actionId: string): RecommendationCandidate {
  const itemGraph = graph();
  const candidate = generateRecommendationCandidates({ state, itemGraph, rules: generatorRules })
    .find((entry) => entry.actionId === actionId);
  expect(candidate).toBeDefined();
  expect(candidate?.feasible).toBe(true);
  return candidate as RecommendationCandidate;
}

describe('adaptive economy v1', () => {
  it('derives current investment and next exact breakpoint by investment type', () => {
    const state = deriveAdaptiveInvestmentStateV1([1, 2], graph(), rules);

    expect(state.evidence).toBe('RECONSTRUCTED');
    expect(state.tracks.weapon).toEqual({
      type: 'weapon',
      currentValue: 1600,
      achievedBreakpoint: 1600,
      nextBreakpoint: 3200,
      soulsToNextBreakpoint: 1600,
    });
    expect(state.tracks.vitality.currentValue).toBe(0);
  });

  it('derives recursive investment value for upgrade-only owned items', () => {
    const firstUpgrade = deriveAdaptiveInvestmentStateV1([8], graph(), rules);
    const nestedUpgrade = deriveAdaptiveInvestmentStateV1([9], graph(), rules);

    expect(firstUpgrade.tracks.weapon.currentValue).toBe(1600);
    expect(firstUpgrade.tracks.weapon.achievedBreakpoint).toBe(1600);
    expect(nestedUpgrade.tracks.weapon.currentValue).toBe(2400);
  });

  it('returns unknown investment evidence when exact rules are unavailable', () => {
    const state = deriveAdaptiveInvestmentStateV1([1, 2], graph(), undefined);

    expect(state.evidence).toBe('UNKNOWN');
    expect(state.tracks.weapon.currentValue).toBe(0);
  });

  it('resolves rules only by exact ruleset and catalog identity', () => {
    expect(resolveRecommendationEconomyRulesV1('ruleset-a', catalogSha256, [rules])).toBe(rules);
    expect(resolveRecommendationEconomyRulesV1('ruleset-b', catalogSha256, [rules])).toBeUndefined();
    expect(resolveRecommendationEconomyRulesV1('ruleset-a', 'b'.repeat(64), [rules])).toBeUndefined();
    expect(resolveRecommendationEconomyRulesV1('ruleset-a', catalogSha256, [{
      ...rules,
      rulesetId: '*',
      catalogSha256: '*',
    }])).toBeUndefined();
  });

  it('derives flex usage from universal occupied slots, not category counts', () => {
    const held = [1, 2, 3, 4, 5, 6, 10, 11, 20, 21];
    const state = deriveAdaptiveSlotStateV1(held, graph(), rules, { evidence: 'UNKNOWN' });

    expect(state.baseSlots).toBe(9);
    expect(state.usedSlots).toBe(10);
    expect(state.usedFlexSlots).toBe(1);
    expect(state.provedFlexLowerBound).toBe(1);
    expect(state.unlockedFlexSlots).toBeUndefined();
    expect(state.freeFlexSlots).toBeUndefined();
    expect(state.evidence).toBe('UNKNOWN');
  });

  it('treats an unverified flex unlock count as unknown capacity', () => {
    const state = deriveAdaptiveSlotStateV1(
      [1, 2, 3, 4, 5, 6, 10, 11, 20, 21],
      graph(),
      rules,
      { unlockedFlexSlots: 3, evidence: 'UNKNOWN' },
    );

    expect(state.provedFlexLowerBound).toBe(1);
    expect(state.unlockedFlexSlots).toBeUndefined();
    expect(state.freeFlexSlots).toBeUndefined();
    expect(state.totalCapacity).toBeUndefined();
  });

  it.each([
    [9, 0],
    [10, 1],
    [11, 2],
    [12, 3],
  ])('uses %i held items only as the unknown flex lower bound of %i', (heldCount, lowerBound) => {
    const held = Array.from({ length: heldCount }, (_, index) => index + 1);
    const state = deriveAdaptiveSlotStateV1(held, graph(), rules, { evidence: 'UNKNOWN' });

    expect(state.usedFlexSlots).toBe(lowerBound);
    expect(state.provedFlexLowerBound).toBe(lowerBound);
    expect(state.unlockedFlexSlots).toBeUndefined();
    expect(state.freeFlexSlots).toBeUndefined();
    expect(state.totalCapacity).toBeUndefined();
  });

  it('reports exact free slots when flex capacity is observed', () => {
    const held = [1, 2, 3, 4, 5, 6, 10, 11, 20, 21];
    const state = deriveAdaptiveSlotStateV1(
      held,
      graph(),
      rules,
      { unlockedFlexSlots: 2, evidence: 'OBSERVED' },
    );

    expect(state.freeBaseSlots).toBe(0);
    expect(state.freeFlexSlots).toBe(1);
    expect(state.totalCapacity).toBe(11);
  });

  it('keeps reconstructed capacity available for a future deterministic upstream source', () => {
    const state = deriveAdaptiveSlotStateV1(
      [1, 2, 3, 4, 5, 6, 10, 11, 20, 21],
      graph(),
      rules,
      { unlockedFlexSlots: 2, evidence: 'RECONSTRUCTED' },
    );

    expect(state.evidence).toBe('RECONSTRUCTED');
    expect(state.unlockedFlexSlots).toBe(2);
    expect(state.freeFlexSlots).toBe(1);
    expect(state.totalCapacity).toBe(11);
  });

  it('reports breakpoint crossings from projected inventory states', () => {
    const before = deriveAdaptiveInvestmentStateV1([1], graph(), rules);
    const after = deriveAdaptiveInvestmentStateV1([1, 2], graph(), rules);
    const weapon = deriveAdaptiveInvestmentDeltasV1(before, after).find((entry) => entry.type === 'weapon');

    expect(weapon?.crossedBreakpoints).toEqual([1600]);
  });

  it('projects BUY through the canonical candidate result and recomputes economy state', () => {
    const node = plannerNode([], 5000);
    const buy = candidateFor(node.decisionState, 'BUY_ITEM:2');
    const result = projectPlannerCandidateV1({ node, candidate: buy, graph: graph(), economyRules: rules });

    expect([...result.node.decisionState.inventory.heldByItemId.keys()]).toEqual([2]);
    expect(result.node.decisionState.economy.spendableSouls.value).toBe(4200);
    expect(result.node.investment.tracks.weapon.currentValue).toBe(800);
  });

  it('projects UPGRADE with component consumption and breakpoint crossing', () => {
    const node = plannerNode([1], 5000);
    const upgrade = candidateFor(node.decisionState, 'UPGRADE_ITEM:7:upgrade-7');
    const result = projectPlannerCandidateV1({ node, candidate: upgrade, graph: graph(), economyRules: rules });

    expect([...result.node.decisionState.inventory.heldByItemId.keys()]).toEqual([7]);
    expect(result.node.decisionState.economy.spendableSouls.value).toBe(4200);
    expect(result.node.investment.tracks.weapon.currentValue).toBe(1600);
    expect(result.investmentDelta.breakpointsCrossed).toBe(1);
  });

  it('projects SELL using the candidate refund and returned-item transition', () => {
    const node = plannerNode([7], 100);
    const sell = candidateFor(node.decisionState, 'SELL_ITEM:7');
    const result = projectPlannerCandidateV1({ node, candidate: sell, graph: graph(), economyRules: rules });

    expect([...result.node.decisionState.inventory.heldByItemId.keys()]).toEqual([1]);
    expect(result.node.decisionState.economy.spendableSouls.value).toBe(900);
    expect(result.node.investment.tracks.weapon.currentValue).toBe(800);
    expect(result.investmentDelta.achievedBreakpointsLost).toBe(1);
  });

  it('projects REPLACE exactly as the canonical candidate result', () => {
    const node = plannerNode([1], 5000);
    const replace = candidateFor(node.decisionState, 'REPLACE_ITEM:1->2');
    const result = projectPlannerCandidateV1({ node, candidate: replace, graph: graph(), economyRules: rules });

    expect([...result.node.decisionState.inventory.heldByItemId.keys()]).toEqual([2]);
    expect(result.node.decisionState.economy.spendableSouls.value).toBe(4600);
    expect(result.node.actions.map((entry) => entry.actionId)).toEqual(['REPLACE_ITEM:1->2']);
  });
});
