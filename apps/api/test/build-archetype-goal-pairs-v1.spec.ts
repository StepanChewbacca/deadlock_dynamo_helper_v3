import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { mineBuildArchetypesV1 } from '../src/statlocker-adaptive/build-archetype-miner-v1';

const graph = createRecommendationItemGraph([
  {
    itemId: 1,
    name: 'Item 1',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['ruleset-a'],
    directPurchaseCost: 500,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 250, returnedItemIds: [] },
    maxCopies: 1,
  },
  {
    itemId: 2,
    name: 'Item 2',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['ruleset-a'],
    directPurchaseCost: 500,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 250, returnedItemIds: [] },
    maxCopies: 1,
  },
]);

function observation(decisionId: string) {
  return {
    heroId: 10,
    rulesetId: 'ruleset-a',
    catalogSha256: 'a'.repeat(64),
    itemGraph: graph,
    trajectory: {
      strategyId: 'observed',
      decisionId,
      initialStateRevision: decisionId,
      matchId: decisionId,
      playerSlot: 0,
      heroId: 10,
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      enemyHeroIds: [],
      initialGameTimeSec: 0,
      initialOwnedItemIds: [],
      slotRules: {
        baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
        maxFlexSlots: 3,
        maxActiveItems: 4,
        evidence: 'RECONSTRUCTED',
      },
      flexCapacity: { evidence: 'UNKNOWN' },
      steps: [
        {
          index: 0,
          actionId: 'BUY_ITEM:1',
          actionType: 'BUY_ITEM',
          goalId: 'core',
          targetItemId: 1,
          gameTimeSec: 100,
        },
        {
          index: 1,
          actionId: 'WAIT_SAVE:2',
          actionType: 'WAIT_SAVE',
          goalId: 'branch',
          targetItemId: 2,
          gameTimeSec: 150,
        },
        {
          index: 2,
          actionId: 'BUY_ITEM:2',
          actionType: 'BUY_ITEM',
          goalId: 'branch',
          targetItemId: 2,
          gameTimeSec: 200,
        },
      ],
      terminalContract: {
        status: 'COMPLETE',
        completedGoalIds: new Set(['core', 'branch']),
        remainingGoalIds: [],
        committedChoiceItemIdsByGroup: new Map([['branch', [2]]]),
        temporaryItemIds: new Set(),
        slotReservations: [],
        situationalWindowStates: [],
        replanReasonCodes: [],
      },
      terminalOwnedItemIds: [1, 2],
      utility: 0,
      confidence: 1,
    },
  } as any;
}

describe('build archetype goal target preservation', () => {
  it('keeps goal-target associations and excludes WAIT barriers from representative transactions', () => {
    const [archetype] = mineBuildArchetypesV1([observation('a'), observation('b')]);

    expect(archetype.orderedGoalTargets).toEqual([
      { goalId: 'core', targetItemId: 1 },
      { goalId: 'branch', targetItemId: 2 },
    ]);
    expect(archetype.representativeActionIds).toEqual(['BUY_ITEM:1', 'BUY_ITEM:2']);
  });
});