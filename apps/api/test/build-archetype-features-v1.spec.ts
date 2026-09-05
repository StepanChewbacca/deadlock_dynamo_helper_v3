import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import {
  buildArchetypeDistanceV1,
  encodeBuildArchetypeFeaturesV1,
} from '../src/statlocker-adaptive/build-archetype-features-v1';
import { createPlannerTrajectoryV2 } from '../src/statlocker-adaptive/planner-trajectory-v2';

const graph = createRecommendationItemGraph([
  { itemId: 1, name: 'Early', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 500, upgradeRecipes: [] },
  { itemId: 2, name: 'Upgrade', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 750 }] },
  { itemId: 10, name: 'Late', slotType: 'spirit', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 3_000, upgradeRecipes: [] },
]);

function trace(options: {
  matchId: string;
  heroId?: number;
  earlyTime?: number;
  lateTime?: number;
  finalOutcome?: number;
}) {
  return createPlannerTrajectoryV2({
    matchId: options.matchId,
    playerKey: 'p1',
    heroId: options.heroId ?? 7,
    patchId: 'patch',
    rulesetId: 'r1',
    catalogSha256: 'a'.repeat(64),
    rankCohort: 'top',
    allyHeroIds: [],
    enemyHeroIds: [],
    finalOutcome: options.finalOutcome,
    transactions: [
      {
        actionType: 'BUY',
        gameTimeSec: options.earlyTime ?? 300,
        targetItemId: 1,
        inventoryBefore: [],
        inventoryAfter: [1],
        slotUsedBefore: 0,
        slotUsedAfter: 1,
        investmentBefore: { weapon: 0, vitality: 0, spirit: 0 },
        investmentAfter: { weapon: 500, vitality: 0, spirit: 0 },
      },
      {
        actionType: 'BUY',
        gameTimeSec: options.lateTime ?? 1_800,
        targetItemId: 10,
        inventoryBefore: [1],
        inventoryAfter: [1, 10],
        slotUsedBefore: 1,
        slotUsedAfter: 2,
        investmentBefore: { weapon: 500, vitality: 0, spirit: 0 },
        investmentAfter: { weapon: 500, vitality: 0, spirit: 3_000 },
      },
    ],
  }, graph);
}

describe('build archetype features v1', () => {
  it('weights early/core progression more strongly than late purchases', () => {
    const encoded = encodeBuildArchetypeFeaturesV1(trace({ matchId: 'm1' }), graph);

    expect(encoded.familyWeights[1]).toBeGreaterThan(encoded.familyWeights[10]);
    expect(encoded.orderedFamilyIds).toEqual([1, 10]);
    expect(encoded.normalizedTiming).toEqual([300 / 1_800, 1]);
  });

  it('keeps final outcome out of the clustering feature representation', () => {
    const won = encodeBuildArchetypeFeaturesV1(trace({ matchId: 'same', finalOutcome: 1 }), graph);
    const lost = encodeBuildArchetypeFeaturesV1(trace({ matchId: 'same', finalOutcome: 0 }), graph);

    expect(won).toEqual(lost);
  });

  it('is deterministic and separates different heroes from the same item sequence', () => {
    const first = encodeBuildArchetypeFeaturesV1(trace({ matchId: 'm2' }), graph);
    const same = encodeBuildArchetypeFeaturesV1(trace({ matchId: 'm2' }), graph);
    const otherHero = encodeBuildArchetypeFeaturesV1(trace({ matchId: 'm3', heroId: 8 }), graph);

    expect(buildArchetypeDistanceV1(first, same)).toBe(0);
    expect(buildArchetypeDistanceV1(first, otherHero)).toBe(1);
  });
});
