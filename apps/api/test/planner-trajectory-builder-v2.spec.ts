import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { PlannerTrajectoryBuilderV2Service } from '../src/statlocker-adaptive/planner-trajectory-builder-v2.service';

const graph = createRecommendationItemGraph([
  { itemId: 1, name: 'A', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [] },
  { itemId: 2, name: 'B', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }] },
]);

describe('planner trajectory builder v2', () => {
  const service = new PlannerTrajectoryBuilderV2Service();

  it('builds only replay-consistent historical traces', () => {
    const result = service.build({
      matchId: 'm', playerKey: 'p', heroId: 1, patchId: 'p', rulesetId: 'r1', catalogSha256: 'a'.repeat(64),
      rankCohort: 'top', allyHeroIds: [], enemyHeroIds: [], itemGraph: graph,
      events: [
        { actionType: 'BUY', gameTimeSec: 100, targetItemId: 1, inventoryBefore: [], inventoryAfter: [1], slotUsedBefore: 0, slotUsedAfter: 1, investmentBefore: { weapon: 0, vitality: 0, spirit: 0 }, investmentAfter: { weapon: 800, vitality: 0, spirit: 0 } },
        { actionType: 'UPGRADE', gameTimeSec: 200, targetItemId: 2, consumedItemIds: [1], inventoryBefore: [1], inventoryAfter: [2], slotUsedBefore: 1, slotUsedAfter: 1, investmentBefore: { weapon: 800, vitality: 0, spirit: 0 }, investmentAfter: { weapon: 1600, vitality: 0, spirit: 0 } },
      ],
    });

    expect(result.accepted).toBe(true);
    expect(result.trajectory?.transactions).toHaveLength(2);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects discontinuous source rows instead of repairing them silently', () => {
    const result = service.build({
      matchId: 'm', playerKey: 'p', heroId: 1, patchId: 'p', rulesetId: 'r1', catalogSha256: 'a'.repeat(64),
      rankCohort: 'top', allyHeroIds: [], enemyHeroIds: [], itemGraph: graph,
      events: [
        { actionType: 'BUY', gameTimeSec: 100, targetItemId: 1, inventoryBefore: [], inventoryAfter: [1], slotUsedBefore: 0, slotUsedAfter: 1, investmentBefore: { weapon: 0, vitality: 0, spirit: 0 }, investmentAfter: { weapon: 800, vitality: 0, spirit: 0 } },
        { actionType: 'UPGRADE', gameTimeSec: 200, targetItemId: 2, consumedItemIds: [1], inventoryBefore: [], inventoryAfter: [2], slotUsedBefore: 0, slotUsedAfter: 1, investmentBefore: { weapon: 0, vitality: 0, spirit: 0 }, investmentAfter: { weapon: 1600, vitality: 0, spirit: 0 } },
      ],
    });

    expect(result.accepted).toBe(false);
    expect(result.trajectory).toBeUndefined();
    expect(result.diagnostics.map((entry) => entry.code)).toContain('INVENTORY_DISCONTINUITY');
  });
});
