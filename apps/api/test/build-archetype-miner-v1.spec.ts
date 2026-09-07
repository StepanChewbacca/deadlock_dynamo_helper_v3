import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { mineBuildArchetypesV1 } from '../src/statlocker-adaptive/build-archetype-miner-v1';

function item(itemId: number, upgradeFrom?: number) {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-a', 'ruleset-b'],
    ...(upgradeFrom === undefined ? { directPurchaseCost: 500 } : {}),
    upgradeRecipes: upgradeFrom === undefined
      ? []
      : [{ recipeId: `upgrade:${itemId}`, consumedItemIds: [upgradeFrom], soulsCost: 500 }],
    sellTransition: { soulsRefund: 250, returnedItemIds: [] as number[] },
    maxCopies: 1,
  };
}

const graph = createRecommendationItemGraph([item(1), item(2, 1), item(3)]);

function observation(
  decisionId: string,
  terminalOwnedItemIds: number[],
  options: { rulesetId?: string; secondTarget?: number; secondTime?: number } = {},
) {
  const rulesetId = options.rulesetId ?? 'ruleset-a';
  const secondTarget = options.secondTarget ?? 2;
  const secondAction = secondTarget === 2 ? 'UPGRADE_ITEM:2:upgrade:2' : `BUY_ITEM:${secondTarget}`;
  return {
    heroId: 10,
    rulesetId,
    catalogSha256: 'a'.repeat(64),
    itemGraph: graph,
    trajectory: {
      strategyId: 'observed',
      decisionId,
      initialStateRevision: `revision:${decisionId}`,
      matchId: `match:${decisionId}`,
      playerSlot: 0,
      heroId: 10,
      rulesetId,
      catalogSha256: 'a'.repeat(64),
      enemyHeroIds: [20, 30],
      initialGameTimeSec: 100,
      initialOwnedItemIds: [],
      slotRules: {
        baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
        maxFlexSlots: 3,
        maxActiveItems: 4,
        evidence: 'RECONSTRUCTED' as const,
      },
      flexCapacity: { unlockedFlexSlots: 3, evidence: 'OBSERVED' as const },
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
          beforeInventoryFingerprint: '',
          afterInventoryFingerprint: '1',
          beforeStateFingerprint: `before:${decisionId}:0`,
          afterStateFingerprint: `after:${decisionId}:0`,
          beforeOwnedItemIds: [],
          afterOwnedItemIds: [1],
          gameTimeSec: 200,
          rulesetId,
          catalogSha256: 'a'.repeat(64),
          heroId: 10,
          enemyHeroIds: [20, 30],
          beforeSlotState: {} as any,
          afterSlotState: {} as any,
          beforeInvestmentState: {} as any,
          afterInvestmentState: {} as any,
        },
        {
          index: 1,
          actionId: secondAction,
          actionType: secondTarget === 2 ? 'UPGRADE_ITEM' as const : 'BUY_ITEM' as const,
          goalId: secondTarget === 2 ? 'mid-upgrade' : 'alternate-core',
          targetItemId: secondTarget,
          sourceItemIds: secondTarget === 2 ? [1] : [],
          consumedItemIds: secondTarget === 2 ? [1] : [],
          removedItemIds: secondTarget === 2 ? [1] : [],
          addedItemIds: [secondTarget],
          soulsDelta: -500,
          beforeInventoryFingerprint: '1',
          afterInventoryFingerprint: String(secondTarget),
          beforeStateFingerprint: `before:${decisionId}:1`,
          afterStateFingerprint: `after:${decisionId}:1`,
          beforeOwnedItemIds: [1],
          afterOwnedItemIds: secondTarget === 2 ? [2] : [1, secondTarget],
          gameTimeSec: options.secondTime ?? 600,
          rulesetId,
          catalogSha256: 'a'.repeat(64),
          heroId: 10,
          enemyHeroIds: [20, 30],
          beforeSlotState: {} as any,
          afterSlotState: {} as any,
          beforeInvestmentState: {} as any,
          afterInvestmentState: {} as any,
        },
      ],
      terminalContract: {
        status: 'COMPLETE' as const,
        completedGoalIds: new Set(['early-core', secondTarget === 2 ? 'mid-upgrade' : 'alternate-core']),
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
  it('clusters coherent trajectories by distance, uses a deterministic medoid, and rejects singleton noise', () => {
    const result = mineBuildArchetypesV1([
      observation('b', [2], { secondTime: 620 }),
      observation('a', [1, 2], { secondTime: 600 }),
      observation('noise', [1, 3], { secondTarget: 3 }),
      observation('other-ruleset', [2], { rulesetId: 'ruleset-b' }),
    ]);

    const scope = result.filter((entry) => entry.rulesetId === 'ruleset-a');
    expect(scope).toHaveLength(1);
    expect(scope[0].supportCount).toBe(2);
    expect(scope[0].scopeProfileCount).toBe(3);
    expect(scope[0].terminalItemIds).toEqual([2]);
    expect(scope[0].orderedGoalIds).toEqual(['early-core', 'mid-upgrade']);
    expect(scope[0].representativeDecisionId).toBe('a');
    expect(scope[0].representativeActionIds).toEqual(['BUY_ITEM:1', 'UPGRADE_ITEM:2:upgrade:2']);
    expect(scope[0].stability).toBeGreaterThan(0.9);
    expect(scope[0].confidence).toBeGreaterThan(0.6);
    expect(result.some((entry) => entry.rulesetId === 'ruleset-b')).toBe(false);
  });

  it('never uses utility/outcome-like values as clustering features', () => {
    const left = observation('left', [2]);
    const right = observation('right', [2]);
    left.trajectory.utility = -1000;
    right.trajectory.utility = 1000;

    const result = mineBuildArchetypesV1([left, right]);
    expect(result).toHaveLength(1);
    expect(result[0].supportCount).toBe(2);
  });
});