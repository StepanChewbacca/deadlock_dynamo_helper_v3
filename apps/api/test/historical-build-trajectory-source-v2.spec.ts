import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { HistoricalBuildTrajectorySourceV2Service } from '../src/statlocker-adaptive/historical-build-trajectory-source-v2.service';
import { HistoricalPlannerTrajectoryExtractorV2Service } from '../src/statlocker-adaptive/historical-planner-trajectory-extractor-v2.service';
import { RecommendationEconomyRulesV1 } from '../src/statlocker-adaptive/adaptive-economy-v1';

const graph = createRecommendationItemGraph([
  { itemId: 1, name: 'A', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [], sellTransition: { soulsRefund: 400, returnedItemIds: [] } },
  { itemId: 2, name: 'B', slotType: 'vitality', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [], sellTransition: { soulsRefund: 400, returnedItemIds: [] } },
]);
const economyRules: RecommendationEconomyRulesV1 = {
  rulesetId: 'r1', catalogSha256: 'a'.repeat(64), baseSlots: 12,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 }, maxFlexSlots: 4, maxActiveItems: 4,
  investmentBreakpoints: { weapon: [1600], vitality: [1600], spirit: [1600] },
};

function repository() {
  const target: any = {
    id: 10,
    matchId: 100,
    heroId: 1,
    team: 0,
    won: true,
    match: { matchId: 100, averageBadge: 67 },
    itemPurchases: [{ itemId: 1, purchaseTimeS: 100, soldTimeS: null, upgradeId: null }],
  };
  const peers = [
    target,
    { id: 11, matchId: 100, heroId: 2, team: 0, won: true },
    { id: 12, matchId: 100, heroId: 3, team: 1, won: false },
  ];
  return {
    find: jest.fn(async (options: any) => options?.where?.heroId === 1 ? [target] : peers),
  } as any;
}

describe('historical build trajectory source v2', () => {
  it('loads exact per-match purchase history with ally/enemy and rank cohort context', async () => {
    const source = new HistoricalBuildTrajectorySourceV2Service(
      repository(),
      new HistoricalPlannerTrajectoryExtractorV2Service(),
    );

    const result = await source.load({
      heroId: 1,
      patchId: 'p1',
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      itemGraph: graph,
      economyRules,
      limit: 100,
    });

    expect(result.rejected).toEqual([]);
    expect(result.trajectories).toHaveLength(1);
    expect(result.trajectories[0]).toMatchObject({
      matchId: '100',
      playerKey: '100:player:10',
      heroId: 1,
      rankCohort: 'badge:60-69',
      allyHeroIds: [2],
      enemyHeroIds: [3],
      finalOutcome: 1,
    });
  });
});
