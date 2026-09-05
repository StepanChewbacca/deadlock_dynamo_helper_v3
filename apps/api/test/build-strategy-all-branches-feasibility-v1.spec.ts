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
    itemId: 6, name: 'W1 upgrade', slotType: 'weapon' as const, active: false,
    availableRulesetIds: ['r1'], upgradeRecipes: [{ recipeId: 'u6', consumedItemIds: [1], soulsCost: 800 }],
    sellTransition: { soulsRefund: 800, returnedItemIds: [1] },
  },
  {
    itemId: 7, name: 'Vitality branch', slotType: 'vitality' as const, active: false,
    availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
  },
]);

function strategy(secondBranchItemId: number, maxSelect = 1): BuildStrategySpecV1 {
  const core = [1, 2, 3, 4].map((itemId, index) => ({
    goalId: `core-${itemId}`, type: 'CORE' as const, phase: 'EARLY' as const,
    targetItemIds: [itemId], minSelect: 1, maxSelect: 1,
    prerequisiteGoalIds: index === 0 ? [] : [`core-${itemId - 1}`], hard: true,
    lifecycleByItemId: { [itemId]: itemId === 1 ? 'UPGRADE_COMPONENT' as const : 'PERMANENT_CORE' as const },
    rationaleCodes: ['CORE'],
  }));
  const branchA = {
    goalId: 'branch-upgrade', type: 'UPGRADE' as const, phase: 'MID' as const,
    targetItemIds: [6], minSelect: 1, maxSelect: 1, prerequisiteGoalIds: ['core-4'], hard: true,
    lifecycleByItemId: { 6: 'PERMANENT_CORE' as const }, rationaleCodes: ['BRANCH'],
  };
  const branchB = {
    goalId: 'branch-other', type: 'CORE' as const, phase: 'MID' as const,
    targetItemIds: [secondBranchItemId], minSelect: 1, maxSelect: 1, prerequisiteGoalIds: ['core-4'], hard: true,
    lifecycleByItemId: { [secondBranchItemId]: 'PERMANENT_CORE' as const }, rationaleCodes: ['BRANCH'],
  };
  return {
    schemaVersion: 1, strategyId: 'branch-strategy', heroId: 1, rulesetId: 'r1', sourcePatchId: 'p',
    support: 1, stability: 1, representativeTraceId: 't',
    goals: [...core, branchA, branchB],
    branchGroups: [{
      branchGroupId: 'main-branch', optionGoalIds: ['branch-upgrade', 'branch-other'],
      minSelect: 1, maxSelect, commitment: 'ON_FIRST_PURCHASE',
    }],
    situationalWindows: [],
    investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
    slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
    terminalPolicy: { requiredGoalIds: core.map((goal) => goal.goalId), allowWaiveSoftGoals: true },
  };
}

const slotRules = {
  baseSlots: 12,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 } as const,
  maxFlexSlots: 0,
  maxActiveItems: 4,
};

describe('build strategy all-branch feasibility v1', () => {
  const service = new BuildStrategyFeasibilityV1Service();

  it('rejects the whole strategy if one advertised branch is unreachable', () => {
    const result = service.validate({ strategy: strategy(5), itemGraph: graph, slotRules });

    expect(result.feasible).toBe(false);
    expect(result.failedGoalId).toBe('branch-other');
    expect(result.reasonCodes).toContain('BRANCH_PATH_UNREACHABLE');
    expect(result.failedBranchSelection).toEqual({ 'main-branch': 'branch-other' });
  });

  it('accepts the strategy only when every advertised branch is reachable', () => {
    const result = service.validate({ strategy: strategy(7), itemGraph: graph, slotRules });

    expect(result.feasible).toBe(true);
    expect(result.validatedBranchPaths).toBe(2);
    expect(result.reasonCodes).toContain('ALL_BRANCH_PATHS_REACHABLE');
  });

  it('fails closed for multi-select branch semantics unsupported by V1 session state', () => {
    const result = service.validate({ strategy: strategy(7, 2), itemGraph: graph, slotRules });

    expect(result.feasible).toBe(false);
    expect(result.reasonCodes).toContain('UNSUPPORTED_MULTI_SELECT_BRANCH');
  });
});
