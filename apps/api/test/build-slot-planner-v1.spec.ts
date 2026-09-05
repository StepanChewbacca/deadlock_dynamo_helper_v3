import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { deriveAdaptiveSlotStateV1 } from '../src/statlocker-adaptive/adaptive-economy-v1';
import { BuildSlotPlannerV1Service } from '../src/statlocker-adaptive/build-slot-planner-v1.service';
import { BuildContractV1, BuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-v1';

const graph = createRecommendationItemGraph([
  ...[1, 2, 3, 4, 5].map((itemId) => ({
    itemId,
    name: `Weapon ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
  })),
  {    itemId: 6,
    name: 'Upgrade 1',
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['r1'],
    upgradeRecipes: [{ recipeId: 'u6', consumedItemIds: [1], soulsCost: 800 }],
    sellTransition: { soulsRefund: 800, returnedItemIds: [1] },
  },
]);

const slotRules = {
  baseSlots: 12,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 } as const,
  maxFlexSlots: 4,
  maxActiveItems: 4,
};

function strategy(targetItemId: number, temporaryItemIds: readonly number[] = []): BuildStrategySpecV1 {
  return {
    schemaVersion: 1,
    strategyId: 's1', heroId: 1, rulesetId: 'r1', sourcePatchId: 'p1', support: 0.5, stability: 0.8,
    representativeTraceId: 'trace',
    goals: [
      ...temporaryItemIds.map((itemId) => ({
        goalId: `temp-${itemId}`,
        type: 'CORE' as const,
        phase: 'EARLY' as const,
        targetItemIds: [itemId],
        minSelect: 0,
        maxSelect: 1,
        prerequisiteGoalIds: [],
        hard: false,
        lifecycleByItemId: { [itemId]: 'TEMPORARY_EARLY' as const },
        rationaleCodes: ['TEMP'],
      })),
      {
        goalId: 'target', type: 'CORE', phase: 'MID', targetItemIds: [targetItemId], minSelect: 1, maxSelect: 1,
        prerequisiteGoalIds: [], hard: true, lifecycleByItemId: { [targetItemId]: 'PERMANENT_CORE' }, rationaleCodes: ['CORE'],
      },
    ],
    branchGroups: [], situationalWindows: [],
    investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
    slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: temporaryItemIds.length },
    terminalPolicy: { requiredGoalIds: ['target'], allowWaiveSoftGoals: true },
  };
}

function explicitOwnedCoreStrategy(softItemId?: number): BuildStrategySpecV1 {
  const ownedGoals = [1, 2, 3, 4].map((itemId) => ({
    goalId: `owned-${itemId}`,
    type: 'CORE' as const,
    phase: 'EARLY' as const,
    targetItemIds: [itemId],
    minSelect: itemId === softItemId ? 0 : 1,
    maxSelect: 1,
    prerequisiteGoalIds: [],
    hard: itemId !== softItemId,
    lifecycleByItemId: { [itemId]: itemId === softItemId ? 'SITUATIONAL' as const : 'PERMANENT_CORE' as const },
    rationaleCodes: [itemId === softItemId ? 'SOFT' : 'CORE'],
  }));
  return {
    schemaVersion: 1,
    strategyId: 'full-core', heroId: 1, rulesetId: 'r1', sourcePatchId: 'p1', support: 1, stability: 1,
    representativeTraceId: 'trace',
    goals: [
      ...ownedGoals,
      {
        goalId: 'target', type: 'CORE' as const, phase: 'MID' as const, targetItemIds: [5], minSelect: 1, maxSelect: 1,
        prerequisiteGoalIds: ownedGoals.filter((goal) => goal.hard).map((goal) => goal.goalId), hard: true,
        lifecycleByItemId: { 5: 'PERMANENT_CORE' as const }, rationaleCodes: ['CORE'],
      },
    ],
    branchGroups: [], situationalWindows: [],
    investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
    slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
    terminalPolicy: { requiredGoalIds: [...ownedGoals.filter((goal) => goal.hard).map((goal) => goal.goalId), 'target'], allowWaiveSoftGoals: true },
  };
}

function contract(
  owned: readonly number[],
  strategyId = 's1',
  softItemId?: number,
  temporaryItemIds: readonly number[] = [],
): BuildContractV1 {
  const goalStates: Record<string, any> = { target: 'ACTIVE' };
  const remainingHardGoalIds = ['target'];
  if (strategyId === 'full-core') {
    for (const itemId of [1, 2, 3, 4]) goalStates[`owned-${itemId}`] = itemId === softItemId ? 'READY' : 'SATISFIED';
  }
  return {
    strategyId,
    status: 'IN_PROGRESS',
    commitment: 'COMMITTED',
    currentGoalId: 'target',
    goalStates,
    selectedBranches: {},
    committedBranches: {},
    temporaryItemIds: owned.filter((itemId) => temporaryItemIds.includes(itemId)),
    reservedSituationalWindowIds: [],
    remainingHardGoalIds,
    completionReasonCodes: ['MANDATORY_GOALS_REMAIN'],
  };
}

describe('build slot planner v1', () => {
  const service = new BuildSlotPlannerV1Service();

  it('keeps a future target locked behind flex instead of recommending an over-capacity buy', () => {
    const owned = [1, 2, 3, 4];
    const slots = deriveAdaptiveSlotStateV1(owned, graph, slotRules, { unlockedFlexSlots: 0, evidence: 'OBSERVED' });
    const plan = service.plan({ strategy: strategy(5), contract: contract(owned), itemGraph: graph, ownedItemIds: owned, slots });

    expect(plan.feasible).toBe(true);
    expect(plan.futureTransitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetGoalId: 'target', targetItemId: 5, requirement: 'FLEX_UNLOCK', requiredUnlockedFlexSlots: 1 }),
    ]));
  });

  it('uses an upgrade path when the target consumes an already occupied component slot', () => {
    const owned = [1, 2, 3, 4];
    const slots = deriveAdaptiveSlotStateV1(owned, graph, slotRules, { unlockedFlexSlots: 0, evidence: 'OBSERVED' });
    const plan = service.plan({ strategy: strategy(6), contract: contract(owned), itemGraph: graph, ownedItemIds: owned, slots });

    expect(plan.futureTransitions[0]).toMatchObject({ targetItemId: 6, requirement: 'UPGRADE', sourceItemId: 1 });
  });

  it('plans a temporary item exit before a new core purchase under slot pressure', () => {
    const owned = [1, 2, 3, 4];
    const slots = deriveAdaptiveSlotStateV1(owned, graph, slotRules, { unlockedFlexSlots: 0, evidence: 'OBSERVED' });
    const plan = service.plan({ strategy: strategy(5, [4]), contract: contract(owned, 's1', undefined, [4]), itemGraph: graph, ownedItemIds: owned, slots });

    expect(plan.futureTransitions[0]).toMatchObject({ targetItemId: 5, requirement: 'SELL_TEMPORARY', sourceItemId: 4 });
  });

  it('allows a base-slot purchase when flex unlock evidence is unknown but no flex is required', () => {
    const owned = [1, 2, 3];
    const slots = deriveAdaptiveSlotStateV1(owned, graph, slotRules, { evidence: 'UNKNOWN' });
    const plan = service.plan({ strategy: strategy(4), contract: contract(owned), itemGraph: graph, ownedItemIds: owned, slots });

    expect(plan.futureTransitions[0]).toMatchObject({ targetItemId: 4, requirement: 'NONE' });
  });

  it('uses an explicit replacement source only when removing it preserves satisfied hard goals', () => {
    const owned = [1, 2, 3, 4];
    const noFlexRules = { ...slotRules, maxFlexSlots: 0 };
    const slots = deriveAdaptiveSlotStateV1(owned, graph, noFlexRules, { unlockedFlexSlots: 0, evidence: 'OBSERVED' });
    const spec = explicitOwnedCoreStrategy(4);
    const plan = service.plan({ strategy: spec, contract: contract(owned, 'full-core', 4), itemGraph: graph, ownedItemIds: owned, slots });

    expect(plan.futureTransitions[0]).toMatchObject({ targetItemId: 5, requirement: 'REPLACE', sourceItemId: 4 });
    expect(plan.feasible).toBe(true);
  });

  it('marks the plan blocked when all slots are committed and no upgrade, sell, replace, or flex path exists', () => {
    const owned = [1, 2, 3, 4];
    const noFlexRules = { ...slotRules, maxFlexSlots: 0 };
    const slots = deriveAdaptiveSlotStateV1(owned, graph, noFlexRules, { unlockedFlexSlots: 0, evidence: 'OBSERVED' });
    const spec = explicitOwnedCoreStrategy();
    const plan = service.plan({ strategy: spec, contract: contract(owned, 'full-core'), itemGraph: graph, ownedItemIds: owned, slots });

    expect(plan.futureTransitions[0]).toMatchObject({ targetItemId: 5, requirement: 'BLOCKED' });
    expect(plan.feasible).toBe(false);
    expect(plan.reasonCodes).toContain('NO_SLOT_FEASIBLE_PATH');
  });
});
