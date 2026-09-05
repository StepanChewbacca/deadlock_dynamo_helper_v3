import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildArchetypeMinerV1Service } from '../src/statlocker-adaptive/build-archetype-miner-v1.service';
import { createPlannerTrajectoryV2 } from '../src/statlocker-adaptive/planner-trajectory-v2';

const graph = createRecommendationItemGraph([
  ...[1, 2, 3, 4, 10, 11, 12].map((itemId) => ({
    itemId,
    name: `Item ${itemId}`,
    slotType: itemId >= 10 ? 'spirit' as const : 'weapon' as const,
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
  })),
]);

function trace(id: string, items: readonly number[], times: readonly number[]) {
  let inventory: number[] = [];
  return createPlannerTrajectoryV2({
    matchId: id,
    playerKey: 'p',
    heroId: 1,
    patchId: 'p1',
    rulesetId: 'r1',
    catalogSha256: 'a'.repeat(64),
    rankCohort: 'top',
    allyHeroIds: [],
    enemyHeroIds: [],
    transactions: items.map((itemId, index) => {
      const before = [...inventory];
      inventory = [...inventory, itemId].sort((a, b) => a - b);
      return {
        actionType: 'BUY' as const,
        gameTimeSec: times[index],
        targetItemId: itemId,
        inventoryBefore: before,
        inventoryAfter: [...inventory],
        slotUsedBefore: before.length,
        slotUsedAfter: inventory.length,
        investmentBefore: { weapon: before.filter((value) => value < 10).length * 800, vitality: 0, spirit: before.filter((value) => value >= 10).length * 800 },
        investmentAfter: { weapon: inventory.filter((value) => value < 10).length * 800, vitality: 0, spirit: inventory.filter((value) => value >= 10).length * 800 },
      };
    }),
  }, graph);
}

describe('build archetype miner v1', () => {
  it('separates coherent build trajectories instead of averaging incompatible paths', () => {
    const miner = new BuildArchetypeMinerV1Service();
    const result = miner.mine([
      trace('a1', [1, 2, 3], [100, 200, 300]),
      trace('a2', [1, 2, 4], [110, 210, 320]),
      trace('b1', [10, 11, 12], [100, 210, 310]),
      trace('b2', [10, 11, 12], [120, 220, 330]),
    ], graph, { distanceThreshold: 0.48, minClusterSize: 2 });

    expect(result.archetypes).toHaveLength(2);
    const familySets = result.archetypes.map((archetype) => new Set(archetype.representativeFamilyIds));
    expect(familySets.some((set) => set.has(1) && !set.has(10))).toBe(true);
    expect(familySets.some((set) => set.has(10) && !set.has(1))).toBe(true);
    expect(result.noiseTraceIds).toEqual([]);
  });

  it('uses a real observed medoid trace as the archetype representative', () => {
    const traces = [
      trace('a1', [1, 2, 3], [100, 200, 300]),
      trace('a2', [1, 2, 4], [110, 210, 320]),
      trace('a3', [1, 2, 3], [105, 205, 305]),
    ];
    const result = new BuildArchetypeMinerV1Service().mine(traces, graph, { distanceThreshold: 0.55, minClusterSize: 2 });
    const archetype = result.archetypes[0];

    expect(traces.map((entry) => entry.traceId)).toContain(archetype.representativeTraceId);
    expect(archetype.support).toBe(1);
    expect(archetype.withinClusterDistance).toBeGreaterThanOrEqual(0);
  });

  it('keeps isolated trajectories as noise rather than merging them into a synthetic build', () => {
    const result = new BuildArchetypeMinerV1Service().mine([
      trace('a1', [1, 2, 3], [100, 200, 300]),
      trace('a2', [1, 2, 4], [110, 210, 320]),
      trace('noise', [10, 12], [900, 1500]),
    ], graph, { distanceThreshold: 0.45, minClusterSize: 2 });

    expect(result.archetypes).toHaveLength(1);
    expect(result.noiseTraceIds.some((id) => id.startsWith('noise:'))).toBe(true);
  });
});
