import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import {
  createPlannerTrajectoryV2,
  plannerTrajectoryFamilyIdV2,
  validatePlannerTrajectoryV2,
} from '../src/statlocker-adaptive/planner-trajectory-v2';

const graph = createRecommendationItemGraph([
  { itemId: 1, name: 'A', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [] },
  { itemId: 2, name: 'B', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }] },
  { itemId: 3, name: 'C', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], upgradeRecipes: [{ recipeId: 'u3', consumedItemIds: [2], soulsCost: 800 }] },
  { itemId: 10, name: 'Other', slotType: 'vitality', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [] },
]);

describe('planner trajectory v2', () => {
  it('assigns one deterministic family id to an upgrade lineage', () => {
    expect(plannerTrajectoryFamilyIdV2(1, graph)).toBe(plannerTrajectoryFamilyIdV2(3, graph));
    expect(plannerTrajectoryFamilyIdV2(1, graph)).not.toBe(plannerTrajectoryFamilyIdV2(10, graph));
  });

  it('creates a stable ordered trace without using final outcome as an archetype feature', () => {
    const trace = createPlannerTrajectoryV2({
      matchId: 'm1', playerKey: 'p1', heroId: 7, patchId: 'p', rulesetId: 'r1', catalogSha256: 'a'.repeat(64),
      rankCohort: 'top', allyHeroIds: [2, 1], enemyHeroIds: [9, 8], finalOutcome: 1,
      transactions: [
        { actionType: 'BUY', gameTimeSec: 100, targetItemId: 1, inventoryBefore: [], inventoryAfter: [1], slotUsedBefore: 0, slotUsedAfter: 1, investmentBefore: { weapon: 0, vitality: 0, spirit: 0 }, investmentAfter: { weapon: 800, vitality: 0, spirit: 0 } },
        { actionType: 'UPGRADE', gameTimeSec: 200, targetItemId: 2, consumedItemIds: [1], inventoryBefore: [1], inventoryAfter: [2], slotUsedBefore: 1, slotUsedAfter: 1, investmentBefore: { weapon: 800, vitality: 0, spirit: 0 }, investmentAfter: { weapon: 1600, vitality: 0, spirit: 0 } },
      ],
    }, graph);

    expect(trace.transactions.map((entry) => entry.familyId)).toEqual([1, 1]);
    expect(trace.allyHeroIds).toEqual([1, 2]);
    expect(trace.enemyHeroIds).toEqual([8, 9]);
    expect(trace.archetypeFeaturePayload).not.toHaveProperty('finalOutcome');
    expect(trace.traceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects discontinuous inventory histories rather than inventing transitions', () => {
    const trace = createPlannerTrajectoryV2({
      matchId: 'm2', playerKey: 'p', heroId: 7, patchId: 'p', rulesetId: 'r1', catalogSha256: 'b'.repeat(64),
      rankCohort: 'top', allyHeroIds: [], enemyHeroIds: [],
      transactions: [
        { actionType: 'BUY', gameTimeSec: 100, targetItemId: 1, inventoryBefore: [], inventoryAfter: [1], slotUsedBefore: 0, slotUsedAfter: 1, investmentBefore: { weapon: 0, vitality: 0, spirit: 0 }, investmentAfter: { weapon: 800, vitality: 0, spirit: 0 } },
        { actionType: 'BUY', gameTimeSec: 200, targetItemId: 10, inventoryBefore: [], inventoryAfter: [10], slotUsedBefore: 0, slotUsedAfter: 1, investmentBefore: { weapon: 0, vitality: 0, spirit: 0 }, investmentAfter: { weapon: 0, vitality: 800, spirit: 0 } },
      ],
    }, graph);

    expect(validatePlannerTrajectoryV2(trace)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVENTORY_DISCONTINUITY', transactionIndex: 1 }),
    ]));
  });
});
