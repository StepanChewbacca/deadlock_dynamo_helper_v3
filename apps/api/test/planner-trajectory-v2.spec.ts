import {
  createRecommendationItemGraph,
  generateRecommendationCandidates,
  observedFact,
} from '@deadlock-live-probe/build-domain';
import { compilePlannerTrajectoryV2 } from '../src/statlocker-adaptive/planner-trajectory-v2';

function item(itemId: number, options: { upgradeFrom?: number; cost?: number } = {}) {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-a'],
    ...(options.upgradeFrom === undefined ? { directPurchaseCost: options.cost ?? 500 } : {}),
    upgradeRecipes: options.upgradeFrom === undefined
      ? []
      : [{ recipeId: `upgrade:${itemId}`, consumedItemIds: [options.upgradeFrom], soulsCost: options.cost ?? 500 }],
    sellTransition: { soulsRefund: 250, returnedItemIds: [] as number[] },
    maxCopies: 1,
  };
}

describe('compilePlannerTrajectoryV2', () => {
  it('uses canonical transitions so consumed upgrade components never survive into later steps', () => {
    const graph = createRecommendationItemGraph([item(1), item(2, { upgradeFrom: 1 })]);
    const state: any = {
      decisionId: 'decision-a',
      matchId: 'match-a',
      playerSlot: 0,
      gameTimeSec: 700,
      rulesetId: 'ruleset-a',
      heroId: 10,
      inventory: {
        initializedFromSnapshot: true,
        heldByItemId: new Map([[1, { itemId: 1, instanceId: 'item-1', lifecycle: 1, acquiredBy: 'RECONCILE', acquiredAtMs: 0 }]]),
        lifecycleCountByItemId: new Map([[1, 1]]),
        nextInstanceSequence: 2,
      },
      economy: {
        spendableSouls: observedFact(5000, 'test'),
        shopOpportunity: observedFact('AVAILABLE', 'test'),
      },
    };
    const rules: any = {
      baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
      maxFlexSlots: 3,
      unlockedFlexSlots: 3,
      flexCapacityEvidence: 'OBSERVED',
      maxActiveItems: 4,
      allowSellOnlyActions: true,
      generateTargetedWaitActions: true,
    };
    const upgrade = generateRecommendationCandidates({ state, itemGraph: graph, rules })
      .find((candidate) => candidate.action.type === 'UPGRADE_ITEM' && candidate.action.itemId === 2);
    expect(upgrade).toBeDefined();

    const trajectory = compilePlannerTrajectoryV2({
      strategyId: 'strategy-a',
      decisionId: 'decision-a',
      initialStateRevision: 'revision-a',
      initialState: state,
      itemGraph: graph,
      actions: [{ candidate: upgrade!, goalId: 'upgrade-core' }],
      terminalContract: {
        status: 'COMPLETE',
        completedGoalIds: new Set(['upgrade-core']),
        remainingGoalIds: [],
        committedChoiceItemIdsByGroup: new Map(),
        temporaryItemIds: new Set(),
        slotReservations: [],
        situationalWindowStates: [],
        replanReasonCodes: [],
      },
      utility: 1,
      confidence: 0.9,
    });

    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0].consumedItemIds).toEqual([1]);
    expect(trajectory.steps[0].afterOwnedItemIds).toEqual([2]);
    expect(trajectory.steps[0].beforeInventoryFingerprint).not.toBe(trajectory.steps[0].afterInventoryFingerprint);
    expect(trajectory.terminalOwnedItemIds).toEqual([2]);
  });
});
