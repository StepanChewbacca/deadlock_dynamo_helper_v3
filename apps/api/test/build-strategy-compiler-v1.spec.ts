import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildArchetypeMinerV1Service } from '../src/statlocker-adaptive/build-archetype-miner-v1.service';
import { BuildStrategyCompilerV1Service } from '../src/statlocker-adaptive/build-strategy-compiler-v1.service';
import { createPlannerTrajectoryV2 } from '../src/statlocker-adaptive/planner-trajectory-v2';

const graph = createRecommendationItemGraph([
  { itemId: 1, name: 'A', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [] },
  { itemId: 2, name: 'B', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [] },
  { itemId: 3, name: 'C', slotType: 'vitality', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 1600, upgradeRecipes: [] },
  { itemId: 4, name: 'D', slotType: 'vitality', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 1600, upgradeRecipes: [] },
  { itemId: 5, name: 'E', slotType: 'spirit', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 3200, upgradeRecipes: [] },
  { itemId: 6, name: 'A upgrade', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], upgradeRecipes: [{ recipeId: 'u6', consumedItemIds: [1], soulsCost: 800 }] },
]);

function trace(id: string, items: readonly number[]) {
  let inventory: number[] = [];
  return createPlannerTrajectoryV2({
    matchId: id, playerKey: 'p', heroId: 1, patchId: 'p1', rulesetId: 'r1', catalogSha256: 'a'.repeat(64),
    rankCohort: 'top', allyHeroIds: [], enemyHeroIds: [],
    transactions: items.map((itemId, index) => {
      const before = [...inventory];
      const isUpgrade = itemId === 6;
      inventory = isUpgrade ? [...inventory.filter((value) => value !== 1), 6] : [...inventory, itemId];
      inventory.sort((a, b) => a - b);
      return {
        actionType: isUpgrade ? 'UPGRADE' as const : 'BUY' as const,
        gameTimeSec: 180 + index * 300,
        targetItemId: itemId,
        consumedItemIds: isUpgrade ? [1] : [],
        inventoryBefore: before,
        inventoryAfter: [...inventory],
        slotUsedBefore: before.length,
        slotUsedAfter: inventory.length,
        investmentBefore: { weapon: 0, vitality: 0, spirit: 0 },
        investmentAfter: { weapon: 0, vitality: 0, spirit: 0 },
      };
    }),
  }, graph);
}

describe('build strategy compiler v1', () => {
  it('compiles a coherent branch without flattening both alternatives into required core', () => {
    const traces = [
      trace('m1', [1, 2, 3, 5]),
      trace('m2', [1, 2, 4, 5]),
      trace('m3', [1, 2, 3, 5]),
      trace('m4', [1, 2, 4, 5]),
    ];
    const archetype = new BuildArchetypeMinerV1Service().mine(traces, graph, { distanceThreshold: 0.7, minClusterSize: 2 }).archetypes[0];
    const spec = new BuildStrategyCompilerV1Service().compile({ archetype, trajectories: traces, itemGraph: graph });

    expect(spec.branchGroups).toHaveLength(1);
    const branch = spec.branchGroups[0];
    expect(branch.minSelect).toBe(1);
    expect(branch.maxSelect).toBe(1);
    const branchItems = branch.optionGoalIds.flatMap((goalId) => spec.goals.find((goal) => goal.goalId === goalId)?.targetItemIds ?? []);
    expect(new Set(branchItems)).toEqual(new Set([3, 4]));
    expect(spec.terminalPolicy.requiredGoalIds.some((goalId) => {
      const goal = spec.goals.find((entry) => entry.goalId === goalId);
      return goal?.targetItemIds.includes(3) && goal.targetItemIds.includes(4);
    })).toBe(false);
  });

  it('marks an observed upgrade as an UPGRADE goal and its earlier component as upgrade lifecycle', () => {
    const traces = [trace('u1', [1, 2, 6, 5]), trace('u2', [1, 2, 6, 5])];
    const archetype = new BuildArchetypeMinerV1Service().mine(traces, graph, { distanceThreshold: 0.8, minClusterSize: 2 }).archetypes[0];
    const spec = new BuildStrategyCompilerV1Service().compile({ archetype, trajectories: traces, itemGraph: graph });
    const upgrade = spec.goals.find((goal) => goal.targetItemIds.includes(6));
    const component = spec.goals.find((goal) => goal.targetItemIds.includes(1));

    expect(upgrade?.type).toBe('UPGRADE');
    expect(component?.lifecycleByItemId[1]).toBe('UPGRADE_COMPONENT');
  });
});
