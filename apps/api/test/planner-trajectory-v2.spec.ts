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
  it('uses canonical transitions and records exact ruleset, roster, slot and investment context', () => {
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
        heldByItemId: new Map([[1, { itemId: 1, name: 'Item 1', slotType: 'weapon', instanceId: 'item-1', lifecycle: 1, acquiredBy: 'RECONCILE', acquiredAtMs: 0 }]]),
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
      activeCapacityEvidence: 'RECONSTRUCTED',
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
      catalogSha256: 'a'.repeat(64),
      enemyHeroIds: [30, 20, 20],
      initialState: state,
      itemGraph: graph,
      slotRules: {
        baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
        maxFlexSlots: 3,
        maxActiveItems: 4,
        evidence: 'RECONSTRUCTED',
      },
      flexCapacity: { unlockedFlexSlots: 3, evidence: 'OBSERVED' },
      economyRules: {
        rulesetId: 'ruleset-a',
        catalogSha256: 'a'.repeat(64),
        baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
        maxFlexSlots: 3,
        maxActiveItems: 4,
        investmentBreakpoints: {
          weapon: [500, 1000],
          vitality: [],
          spirit: [],
        },
      },
      actions: [{ candidate: upgrade!, goalId: 'upgrade-core', gameTimeSec: 725 }],
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

    expect(trajectory.rulesetId).toBe('ruleset-a');
    expect(trajectory.catalogSha256).toBe('a'.repeat(64));
    expect(trajectory.enemyHeroIds).toEqual([20, 30]);
    expect(trajectory.initialOwnedItemIds).toEqual([1]);
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0].gameTimeSec).toBe(725);
    expect(trajectory.steps[0].enemyHeroIds).toEqual([20, 30]);
    expect(trajectory.steps[0].consumedItemIds).toEqual([1]);
    expect(trajectory.steps[0].afterOwnedItemIds).toEqual([2]);
    expect(trajectory.steps[0].beforeInventoryFingerprint).not.toBe(trajectory.steps[0].afterInventoryFingerprint);
    expect(trajectory.steps[0].beforeStateFingerprint).not.toBe(trajectory.steps[0].afterStateFingerprint);
    expect(trajectory.steps[0].beforeSlotState.usedByType.weapon).toBe(1);
    expect(trajectory.steps[0].afterSlotState.usedByType.weapon).toBe(1);
    expect(trajectory.steps[0].beforeInvestmentState.tracks.weapon.currentValue).toBe(500);
    expect(trajectory.steps[0].afterInvestmentState.tracks.weapon.currentValue).toBe(1000);
    expect(trajectory.terminalOwnedItemIds).toEqual([2]);
  });

  it('rejects trajectory context that does not match the exact ruleset/catalog scope', () => {
    const graph = createRecommendationItemGraph([item(1)]);
    const state: any = {
      decisionId: 'decision-a',
      matchId: 'match-a',
      playerSlot: 0,
      gameTimeSec: 1,
      rulesetId: 'ruleset-a',
      heroId: 10,
      inventory: {
        initializedFromSnapshot: true,
        heldByItemId: new Map(),
        lifecycleCountByItemId: new Map(),
        nextInstanceSequence: 1,
      },
      economy: {
        spendableSouls: observedFact(5000, 'test'),
        shopOpportunity: observedFact('AVAILABLE', 'test'),
      },
    };

    expect(() => compilePlannerTrajectoryV2({
      strategyId: 'strategy-a',
      decisionId: 'decision-a',
      initialStateRevision: 'revision-a',
      catalogSha256: 'a'.repeat(64),
      enemyHeroIds: [],
      initialState: state,
      itemGraph: graph,
      slotRules: {
        baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
        maxFlexSlots: 3,
        maxActiveItems: 4,
        evidence: 'RECONSTRUCTED',
      },
      economyRules: {
        rulesetId: 'different-ruleset',
        catalogSha256: 'a'.repeat(64),
        baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
        maxFlexSlots: 3,
        maxActiveItems: 4,
        investmentBreakpoints: { weapon: [], vitality: [], spirit: [] },
      },
      actions: [],
      terminalContract: {
        status: 'COMPLETE',
        completedGoalIds: new Set(),
        remainingGoalIds: [],
        committedChoiceItemIdsByGroup: new Map(),
        temporaryItemIds: new Set(),
        slotReservations: [],
        situationalWindowStates: [],
        replanReasonCodes: [],
      },
      utility: 0,
      confidence: 0,
    })).toThrow('TRAJECTORY_ECONOMY_RULESET_MISMATCH');
  });
});