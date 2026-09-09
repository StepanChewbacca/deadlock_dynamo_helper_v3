import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { deriveAdaptiveSlotStateV1 } from '../src/statlocker-adaptive/adaptive-economy-v1';
import { BuildSlotPlannerV1Service } from '../src/statlocker-adaptive/build-slot-planner-v1.service';
import { BuildContractV1, BuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-v1';

const regularItems = Array.from({ length: 13 }, (_, index) => ({
  itemId: index + 1,
  name: `Item ${index + 1}`,
  slotType: 'weapon' as const,
  active: false,
  availableRulesetIds: ['r1'],
  directPurchaseCost: 500,
  upgradeRecipes: [],
  sellTransition: { soulsRefund: 250, returnedItemIds: [] },
}));

const graph = createRecommendationItemGraph([
  ...regularItems,
  {
    itemId: 14,
    name: 'Upgrade 14',
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['r1'],
    upgradeRecipes: [{ recipeId: 'u14', consumedItemIds: [1], soulsCost: 1000 }],
    sellTransition: { soulsRefund: 750, returnedItemIds: [1] },
  },
]);

const canonicalSlotRules = {
  baseSlots: 0,
  baseSlotsByType: { weapon: 0, vitality: 0, spirit: 0 } as const,
  maxFlexSlots: 12,
  maxActiveItems: 4,
  evidence: 'RECONSTRUCTED' as const,
};

function strategy(): BuildStrategySpecV1 {
  return {
    schemaVersion: 1,
    strategyId: 'held-count',
    heroId: 1,
    rulesetId: 'r1',
    sourcePatchId: 'p1',
    support: 1,
    stability: 1,
    representativeTraceId: 'trace',
    goals: [{
      goalId: 'target',
      type: 'CORE',
      phase: 'MID',
      targetItemIds: [14],
      minSelect: 1,
      maxSelect: 1,
      prerequisiteGoalIds: [],
      hard: true,
      lifecycleByItemId: { 14: 'PERMANENT_CORE' },
      rationaleCodes: ['CORE'],
    }],
    branchGroups: [],
    situationalWindows: [],
    investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
    slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
    terminalPolicy: { requiredGoalIds: ['target'], allowWaiveSoftGoals: true },
  };
}

function contract(): BuildContractV1 {
  return {
    strategyId: 'held-count',
    status: 'IN_PROGRESS',
    commitment: 'COMMITTED',
    currentGoalId: 'target',
    goalStates: { target: 'ACTIVE' },
    selectedBranches: {},
    committedBranches: {},
    temporaryItemIds: [],
    reservedSituationalWindowIds: [],
    remainingHardGoalIds: ['target'],
    completionReasonCodes: ['MANDATORY_GOALS_REMAIN'],
  };
}

describe('build slot planner held item count v1', () => {
  it('accepts an upgrade at twelve held items when consuming its component keeps the projection at twelve', () => {
    const ownedItemIds = regularItems.slice(0, 12).map((item) => item.itemId);
    const slots = deriveAdaptiveSlotStateV1(
      ownedItemIds,
      graph,
      canonicalSlotRules,
      { unlockedFlexSlots: 12, evidence: 'OBSERVED' },
    );

    const plan = new BuildSlotPlannerV1Service().plan({
      strategy: strategy(),
      contract: contract(),
      itemGraph: graph,
      ownedItemIds,
      slots,
    });

    expect(plan.futureTransitions[0]).toMatchObject({
      targetItemId: 14,
      requirement: 'UPGRADE',
      sourceItemId: 1,
    });
    expect(plan.feasible).toBe(true);
  });

  it('rejects an upgrade when consuming its component still leaves more than twelve held items', () => {
    const ownedItemIds = regularItems.map((item) => item.itemId);
    const slots = deriveAdaptiveSlotStateV1(
      ownedItemIds,
      graph,
      canonicalSlotRules,
      { unlockedFlexSlots: 12, evidence: 'OBSERVED' },
    );

    const plan = new BuildSlotPlannerV1Service().plan({
      strategy: strategy(),
      contract: contract(),
      itemGraph: graph,
      ownedItemIds,
      slots,
    });

    expect(plan.futureTransitions[0]).toMatchObject({
      targetItemId: 14,
      requirement: 'BLOCKED',
    });
    expect(plan.feasible).toBe(false);
    expect(plan.reasonCodes).toContain('NO_SLOT_FEASIBLE_PATH');
  });
});
