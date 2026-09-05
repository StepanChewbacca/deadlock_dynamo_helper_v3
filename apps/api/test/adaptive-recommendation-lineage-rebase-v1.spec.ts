import {
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  observedFact,
} from '@deadlock-live-probe/build-domain';
import { rebasePlanAgainstDecisionV1 } from '../src/statlocker-adaptive/adaptive-recommendation-v1.service';

const graph = createRecommendationItemGraph([
  {
    itemId: 1,
    name: 'Lower component',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 500,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 250, returnedItemIds: [] },
  },
  {
    itemId: 2,
    name: 'Owned upgrade',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    upgradeRecipes: [{ recipeId: 'upgrade-2', consumedItemIds: [1], soulsCost: 500 }],
    sellTransition: { soulsRefund: 500, returnedItemIds: [1] },
  },
  {
    itemId: 3,
    name: 'Future core',
    slotType: 'vitality',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 1250,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 625, returnedItemIds: [] },
  },
]);

const inventory = {
  initializedFromSnapshot: true,
  heldByItemId: buildInventoryInstancesForRecommendation([2], graph),
  lifecycleCountByItemId: new Map([[2, 1]]),
  nextInstanceSequence: 2,
};

const decision: any = {
  state: {
    decisionId: 'd',
    matchId: 'm',
    playerSlot: 0,
    gameTimeSec: 400,
    rulesetId: 'r1',
    heroId: 1,
    inventory,
    economy: {
      spendableSouls: observedFact(5000, 'test'),
      shopOpportunity: observedFact('AVAILABLE', 'test'),
    },
  },
  itemGraph: graph,
};

describe('adaptive recommendation lineage-aware rebase', () => {
  it('omits a consumed ancestor that is already satisfied by an exact owned upgrade', () => {
    const rebased = rebasePlanAgainstDecisionV1([
      {
        itemId: 2, position: 1, status: 'OWNED', score: 1, confidence: 1,
        skeletonStrength: 1, contextualSupport: 1, reasonCodes: ['OWNED'],
      },
      {
        itemId: 1, position: 2, status: 'NEXT', score: 0.9, confidence: 0.8,
        skeletonStrength: 1, contextualSupport: 1, reasonCodes: ['STALE_COMPONENT'],
      },
      {
        itemId: 3, position: 3, status: 'PLANNED', score: 0.8, confidence: 0.8,
        skeletonStrength: 1, contextualSupport: 1, reasonCodes: ['CORE'],
      },
    ], decision);

    expect(rebased.map((entry) => [entry.itemId, entry.status])).toEqual([
      [2, 'OWNED'],
      [3, 'NEXT'],
    ]);
  });

  it('does not invent a NEXT row when every remaining historical row is already satisfied', () => {
    const rebased = rebasePlanAgainstDecisionV1([
      {
        itemId: 1, position: 1, status: 'NEXT', score: 1, confidence: 1,
        skeletonStrength: 1, contextualSupport: 1, reasonCodes: ['STALE_COMPONENT'],
      },
      {
        itemId: 2, position: 2, status: 'PLANNED', score: 1, confidence: 1,
        skeletonStrength: 1, contextualSupport: 1, reasonCodes: ['UPGRADE'],
      },
    ], decision);

    expect(rebased).toEqual([
      expect.objectContaining({ itemId: 2, position: 1, status: 'OWNED' }),
    ]);
  });
});
