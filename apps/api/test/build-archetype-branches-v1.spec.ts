import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { mineBuildArchetypesV1 } from '../src/statlocker-adaptive/build-archetype-miner-v1';

function definition(itemId: number) {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-a'],
    directPurchaseCost: 500,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 250, returnedItemIds: [] as number[] },
    maxCopies: 1,
  };
}

const graph = createRecommendationItemGraph([1, 2, 3, 4].map(definition));

function observation(decisionId: string, branchItemId: number) {
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
      flexCapacity: { unlockedFlexSlots: 3, evidence: 'OBSERVED' },
      steps: [
        {
          index: 0,
          actionId: 'BUY_ITEM:1',
          actionType: 'BUY_ITEM',
          goalId: 'core',
          targetItemId: 1,
          sourceItemIds: [],
          gameTimeSec: 100,
        },
        {
          index: 1,
          actionId: `BUY_ITEM:${branchItemId}`,
          actionType: 'BUY_ITEM',
          goalId: 'mid-branch',
          targetItemId: branchItemId,
          sourceItemIds: [],
          gameTimeSec: 300,
        },
        {
          index: 2,
          actionId: `REPLACE_ITEM:${branchItemId}:4`,
          actionType: 'REPLACE_ITEM',
          goalId: 'late-core',
          targetItemId: 4,
          sourceItemIds: [branchItemId],
          gameTimeSec: 600,
        },
      ],
      terminalContract: {
        status: 'COMPLETE',
        completedGoalIds: new Set(['core', 'mid-branch', 'late-core']),
        remainingGoalIds: [],
        committedChoiceItemIdsByGroup: new Map([['mid-branch', [branchItemId]]]),
        temporaryItemIds: new Set(),
        slotReservations: [],
        situationalWindowStates: [],
        replanReasonCodes: [],
      },
      terminalOwnedItemIds: [1, 4],
      utility: 0,
      confidence: 1,
    },
  } as any;
}

describe('mined build archetype branch structure', () => {
  it('aggregates coherent XOR branch alternatives while keeping the medoid exit path explicit', () => {
    const [archetype] = mineBuildArchetypesV1([
      observation('a', 2),
      observation('b', 3),
    ]);

    expect(archetype.branchAlternatives).toEqual([{
      groupId: 'mid-branch',
      alternatives: [[2], [3]],
    }]);
    expect(archetype.observedExitItemIds).toEqual([2]);
    expect(archetype.representativeActionIds).toContain('REPLACE_ITEM:2:4');
  });
});