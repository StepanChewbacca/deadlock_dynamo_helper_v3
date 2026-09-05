import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildStrategyFeasibilityV1Service } from '../src/statlocker-adaptive/build-strategy-feasibility-v1.service';
import { BuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-v1';

const graph = createRecommendationItemGraph([
  ...[1, 2, 3, 4, 5].map((itemId) => ({
    itemId, name: `W${itemId}`, slotType: 'weapon' as const, active: false,
    availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
  })),
  {
    itemId: 6, name: 'Upgrade', slotType: 'weapon' as const, active: false,
    availableRulesetIds: ['r1'], upgradeRecipes: [{ recipeId: 'u6', consumedItemIds: [1], soulsCost: 800 }],
    sellTransition: { soulsRefund: 800, returnedItemIds: [1] },
  },
]);

function spec(targets: readonly number[]): BuildStrategySpecV1 {
  const goals = targets.map((itemId, index) => ({
    goalId: `g${index}`, type: itemId === 6 ? 'UPGRADE' as const : 'CORE' as const,
    phase: 'EARLY' as const, targetItemIds: [itemId], minSelect: 1, maxSelect: 1,
    prerequisiteGoalIds: index === 0 ? [] : [`g${index - 1}`], hard: true,
    lifecycleByItemId: { [itemId]: itemId === 1 ? 'UPGRADE_COMPONENT' as const : 'PERMANENT_CORE' as const },
    rationaleCodes: ['TEST'],
  }));
  return {
    schemaVersion: 1, strategyId: 's', heroId: 1, rulesetId: 'r1', sourcePatchId: 'p', support: 1, stability: 1,
    representativeTraceId: 't', goals, branchGroups: [], situationalWindows: [],
    investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
    slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
    terminalPolicy: { requiredGoalIds: goals.map((goal) => goal.goalId), allowWaiveSoftGoals: true },
  };
}

describe('build strategy feasibility v1', () => {
  const service = new BuildStrategyFeasibilityV1Service();

  it('finds a legal transaction realization through an upgrade that reuses a slot', () => {
    const result = service.validate({
      strategy: spec([1, 2, 3, 4, 6]),
      itemGraph: graph,
      slotRules: { baseSlots: 12, baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 }, maxFlexSlots: 0, maxActiveItems: 4 },
    });

    expect(result.feasible).toBe(true);
    expect(result.actionIds.some((actionId) => actionId.startsWith('UPGRADE_ITEM:6:'))).toBe(true);
  });

  it('rejects a mandatory path that needs a fifth category slot with no flex or exit transition', () => {
    const result = service.validate({
      strategy: spec([1, 2, 3, 4, 5]),
      itemGraph: graph,
      slotRules: { baseSlots: 12, baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 }, maxFlexSlots: 0, maxActiveItems: 4 },
    });

    expect(result.feasible).toBe(false);
    expect(result.reasonCodes).toContain('MANDATORY_GOAL_UNREACHABLE');
    expect(result.failedGoalId).toBe('g4');
  });
});
