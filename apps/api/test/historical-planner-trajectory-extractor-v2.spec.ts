import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { HistoricalPlannerTrajectoryExtractorV2Service } from '../src/statlocker-adaptive/historical-planner-trajectory-extractor-v2.service';
import { RecommendationEconomyRulesV1 } from '../src/statlocker-adaptive/adaptive-economy-v1';

const graph = createRecommendationItemGraph([
  {
    itemId: 1,
    name: 'Component',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
  },
  {
    itemId: 2,
    name: 'Upgrade',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 1600,
    upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }],
    sellTransition: { soulsRefund: 800, returnedItemIds: [1] },
  },
  {
    itemId: 3,
    name: 'Temporary',
    slotType: 'vitality',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
  },
]);

const economyRules: RecommendationEconomyRulesV1 = {
  rulesetId: 'r1',
  catalogSha256: 'a'.repeat(64),
  baseSlots: 12,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
  maxFlexSlots: 4,
  maxActiveItems: 4,
  investmentBreakpoints: {
    weapon: [1600, 3200],
    vitality: [1600, 3200],
    spirit: [1600, 3200],
  },
};

describe('historical planner trajectory extractor v2', () => {
  const extractor = new HistoricalPlannerTrajectoryExtractorV2Service();

  it('reconstructs buy, recipe upgrade, temporary buy and explicit sell without leaking outcome into features', () => {
    const result = extractor.extract({
      matchId: 'm1',
      playerKey: 'm1:player:1',
      heroId: 1,
      patchId: 'p1',
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      rankCohort: 'badge:60-69',
      allyHeroIds: [10],
      enemyHeroIds: [20],
      finalOutcome: 1,
      itemGraph: graph,
      economyRules,
      itemRows: [
        { itemId: 1, purchaseTimeS: 100, soldTimeS: 200, upgradeId: 2 },
        { itemId: 2, purchaseTimeS: 200, soldTimeS: undefined, upgradeId: undefined },
        { itemId: 3, purchaseTimeS: 300, soldTimeS: 400, upgradeId: undefined },
      ],
    });

    expect(result.accepted).toBe(true);
    expect(result.trajectory?.transactions.map((entry) => entry.actionType)).toEqual([
      'BUY', 'UPGRADE', 'BUY', 'SELL',
    ]);
    expect(result.trajectory?.transactions[1]).toMatchObject({
      targetItemId: 2,
      consumedItemIds: [1],
      inventoryBefore: [1],
      inventoryAfter: [2],
    });
    expect(result.trajectory?.transactions[3]).toMatchObject({
      sellItemId: 3,
      inventoryBefore: [2, 3],
      inventoryAfter: [2],
    });
    expect(result.trajectory?.finalOutcome).toBe(1);
    expect('finalOutcome' in (result.trajectory?.archetypeFeaturePayload ?? {})).toBe(false);
  });

  it('fails closed instead of inventing state when an explicit sale cannot be reconciled', () => {
    const result = extractor.extract({
      matchId: 'm2',
      playerKey: 'm2:player:1',
      heroId: 1,
      patchId: 'p1',
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      rankCohort: 'badge:60-69',
      allyHeroIds: [],
      enemyHeroIds: [],
      itemGraph: graph,
      economyRules,
      itemRows: [{ itemId: 3, purchaseTimeS: undefined, soldTimeS: 400, upgradeId: undefined }],
    });

    expect(result.accepted).toBe(false);
    expect(result.diagnostics).toContain('SELL_ITEM_NOT_HELD:3');
  });
});
