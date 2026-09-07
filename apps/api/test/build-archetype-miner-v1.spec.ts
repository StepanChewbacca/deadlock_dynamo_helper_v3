import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { mineBuildArchetypesV1 } from '../src/statlocker-adaptive/build-archetype-miner-v1';

function item(itemId: number, upgradeFrom?: number) {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-a'],
    ...(upgradeFrom === undefined ? { directPurchaseCost: 500 } : {}),
    upgradeRecipes: upgradeFrom === undefined
      ? []
      : [{ recipeId: `upgrade:${itemId}`, consumedItemIds: [upgradeFrom], soulsCost: 500 }],
    sellTransition: { soulsRefund: 250, returnedItemIds: [] as number[] },
    maxCopies: 1,
  };
}

function observation(decisionId: string, terminalOwnedItemIds: number[], rulesetId = 'ruleset-a') {
  return {
    heroId: 10,
    rulesetId,
    catalogSha256: 'a'.repeat(64),
    itemGraph: createRecommendationItemGraph([item(1), item(2, 1), item(3)]),
    trajectory: {
      strategyId: 'observed',
      decisionId,
      initialStateRevision: `revision:${decisionId}`,
      steps: [
        {
          index: 0,
          actionId: 'BUY_ITEM:1',
          actionType: 'BUY_ITEM' as const,
          goalId: 'early-core',
          targetItemId: 1,
          sourceItemIds: [],
          consumedItemIds: [],
          removedItemIds: [],
          addedItemIds: [1],
          soulsDelta: -500,
          beforeInventoryFingerprint: '[]',
          afterInventoryFingerprint: '[1]',
          beforeOwnedItemIds: [],
          afterOwnedItemIds: [1],
        },
        {
          index: 1,
          actionId: 'UPGRADE_ITEM:2',
          actionType: 'UPGRADE_ITEM' as const,
          goalId: 'mid-upgrade',
          targetItemId: 2,
          sourceItemIds: [1],
          consumedItemIds: [1],
          removedItemIds: [1],
          addedItemIds: [2],
          soulsDelta: -500,
          beforeInventoryFingerprint: '[1]',
          afterInventoryFingerprint: '[2]',
          beforeOwnedItemIds: [1],
          afterOwnedItemIds: [2],
        },
      ],
      terminalContract: {
        status: 'COMPLETE' as const,
        completedGoalIds: new Set(['early-core', 'mid-upgrade']),
        remainingGoalIds: [],
        committedChoiceItemIdsByGroup: new Map(),
        temporaryItemIds: new Set(),
        slotReservations: [],
        situationalWindowStates: [],
        replanReasonCodes: [],
      },
      terminalOwnedItemIds,
      utility: 1,
      confidence: 0.9,
    },
  };
}

describe('mineBuildArchetypesV1', () => {
  it('groups coherent same-scope trajectories and collapses terminal lineage components', () => {
    const result = mineBuildArchetypesV1([
      observation('a', [1, 2]),
      observation('b', [2]),
      observation('other-ruleset', [2], 'ruleset-b'),
    ]);

    const scope = result.filter((entry) => entry.rulesetId === 'ruleset-a');
    expect(scope).toHaveLength(1);
    expect(scope[0].supportCount).toBe(2);
    expect(scope[0].scopeProfileCount).toBe(2);
    expect(scope[0].confidence).toBe(1);
    expect(scope[0].terminalItemIds).toEqual([2]);
    expect(scope[0].orderedGoalIds).toEqual(['early-core', 'mid-upgrade']);
  });
});
