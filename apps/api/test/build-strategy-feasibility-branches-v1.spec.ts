import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildStrategyFeasibilityV1Service } from '../src/statlocker-adaptive/build-strategy-feasibility-v1.service';
import { BuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-v1';

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
]);

function strategy(): BuildStrategySpecV1 {
  return {
    schemaVersion: 1,
    strategyId: 'branch-strategy',
    heroId: 1,
    rulesetId: 'r1',
    sourcePatchId: 'p1',
    support: 1,
    stability: 1,
    representativeTraceId: 't1',
    goals: [
      ...[1, 2, 3, 4].map((itemId, index) => ({
        goalId: `core-${index + 1}`,
        type: 'CORE' as const,
        phase: 'EARLY' as const,
        targetItemIds: [itemId],
        minSelect: 1,
        maxSelect: 1,
        prerequisiteGoalIds: index === 0 ? [] : [`core-${index}`],
        hard: true,
        lifecycleByItemId: { [itemId]: 'PERMANENT_CORE' as const },
        rationaleCodes: ['CORE'],
      })),
      {
        goalId: 'branch-keep-slots',
        type: 'BRANCH' as const,
        phase: 'MID' as const,
        targetItemIds: [4],
        minSelect: 1,
        maxSelect: 1,
        prerequisiteGoalIds: ['core-4'],
        hard: true,
        lifecycleByItemId: { 4: 'PERMANENT_CORE' as const },
        rationaleCodes: ['BRANCH'],
      },
      {
        goalId: 'branch-fifth-weapon',
        type: 'BRANCH' as const,
        phase: 'MID' as const,
        targetItemIds: [5],
        minSelect: 1,
        maxSelect: 1,
        prerequisiteGoalIds: ['core-4'],
        hard: true,
        lifecycleByItemId: { 5: 'PERMANENT_CORE' as const },
        rationaleCodes: ['BRANCH'],
      },
    ],
    branchGroups: [{
      branchGroupId: 'mid-choice',
      optionGoalIds: ['branch-keep-slots', 'branch-fifth-weapon'],
      minSelect: 1,
      maxSelect: 1,
    }],
    situationalWindows: [],
    investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
    slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
    terminalPolicy: {
      requiredGoalIds: ['core-1', 'core-2', 'core-3', 'core-4'],
      allowWaiveSoftGoals: true,
    },
  };
}

describe('build strategy feasibility branch coverage v1', () => {
  it('rejects a strategy when a non-default branch option is unreachable', () => {
    const result = new BuildStrategyFeasibilityV1Service().validate({
      strategy: strategy(),
      itemGraph: graph,
      slotRules: {
        baseSlots: 12,
        baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
        maxFlexSlots: 0,
        maxActiveItems: 4,
      },
    });

    expect(result.feasible).toBe(false);
    expect(result.failedGoalId).toBe('branch-fifth-weapon');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'MANDATORY_GOAL_UNREACHABLE',
      'BRANCH_OPTION_UNREACHABLE',
      'BRANCH_PATH:mid-choice=branch-fifth-weapon',
    ]));
  });

  it('fails closed when V1 receives a multi-select branch contract it cannot represent', () => {
    const invalid = {
      ...strategy(),
      branchGroups: [{
        branchGroupId: 'multi',
        optionGoalIds: ['branch-keep-slots', 'branch-fifth-weapon'],
        minSelect: 1,
        maxSelect: 2,
      }],
    } satisfies BuildStrategySpecV1;

    const result = new BuildStrategyFeasibilityV1Service().validate({
      strategy: invalid,
      itemGraph: graph,
      slotRules: {
        baseSlots: 12,
        baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
        maxFlexSlots: 4,
        maxActiveItems: 4,
      },
    });

    expect(result.feasible).toBe(false);
    expect(result.reasonCodes).toContain('UNSUPPORTED_MULTI_SELECT_BRANCH_V1');
  });
});
