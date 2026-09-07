import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import {
  BuildContractInputV1,
  compileBuildContractV1,
  createOutOfDistributionBuildContractV1,
} from '../src/statlocker-adaptive/build-contract-v1';
import { ConsensusSkeletonV1 } from '../src/statlocker-adaptive/statlocker-adaptive.types';

function item(itemId: number, upgradeFrom?: number) {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-a'],
    ...(upgradeFrom === undefined ? { directPurchaseCost: 800 } : {}),
    upgradeRecipes: upgradeFrom === undefined
      ? []
      : [{ recipeId: `upgrade:${itemId}`, consumedItemIds: [upgradeFrom], soulsCost: 800 }],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    maxCopies: 1,
  };
}

function candidate(itemId: number, overrides: Record<string, unknown> = {}) {
  return {
    itemId,
    strength: 0.8,
    coverage: 0.8,
    purchaseRate: 0.8,
    medianBuyTimeS: 900,
    timingSpreadS: 90,
    sourceProfileCount: 10,
    frequencyTier: 'CORE' as const,
    rushEvidence: false,
    ...overrides,
  };
}

function skeleton(): ConsensusSkeletonV1 {
  return {
    heroId: 10,
    profileCount: 10,
    groups: [
      {
        groupId: 'early-core',
        phase: 'EARLY',
        type: 'REQUIRED',
        minSelect: 1,
        maxSelect: 1,
        candidates: [candidate(1, {
          strength: 0.9,
          coverage: 0.9,
          purchaseRate: 0.9,
          medianBuyTimeS: 240,
          timingSpreadS: 60,
        })],
        confidence: 0.9,
        inferred: false,
      },
      {
        groupId: 'mid-branch',
        phase: 'MID',
        type: 'CHOICE',
        minSelect: 1,
        maxSelect: 1,
        candidates: [2, 3].map((itemId) => candidate(itemId)),
        confidence: 0.9,
        inferred: false,
      },
      {
        groupId: 'situational-option',
        phase: 'MID',
        type: 'OPTIONAL',
        minSelect: 0,
        maxSelect: 1,
        candidates: [candidate(50, { frequencyTier: 'SOMETIMES' as const })],
        confidence: 0.8,
        inferred: false,
      },
    ],
  };
}

function input(
  ownedItemIds: readonly number[],
  options: Partial<Pick<
    BuildContractInputV1,
    | 'executionState'
    | 'committedChoiceItemIdsByGroup'
    | 'futureGoalTargetItemIdsByGoal'
    | 'slotReservations'
  >> = {},
): BuildContractInputV1 {
  return {
    skeleton: skeleton(),
    itemGraph: createRecommendationItemGraph([item(1), item(2, 1), item(3, 1), item(50), item(99)]),
    ownedItemIds,
    executionState: options.executionState ?? 'ACTIONABLE',
    committedChoiceItemIdsByGroup: options.committedChoiceItemIdsByGroup ?? new Map(),
    futureGoalTargetItemIdsByGoal: options.futureGoalTargetItemIdsByGoal,
    slotReservations: options.slotReservations,
  };
}

describe('compileBuildContractV1', () => {
  it('keeps a build IN_PROGRESS when mandatory goals remain even if no transaction is currently executable', () => {
    const contract = compileBuildContractV1(input([], { executionState: 'HOLD' }));

    expect(contract.status).toBe('IN_PROGRESS');
    expect(contract.currentGoalId).toBe('early-core');
    expect(contract.remainingGoalIds).toEqual(['early-core', 'mid-branch']);
  });

  it('marks the build COMPLETE only when every mandatory goal and committed branch is satisfied', () => {
    const incomplete = compileBuildContractV1(input([1], {
      committedChoiceItemIdsByGroup: new Map([['mid-branch', [2]]]),
    }));
    const complete = compileBuildContractV1(input([2], {
      committedChoiceItemIdsByGroup: new Map([['mid-branch', [2]]]),
    }));

    expect(incomplete.status).toBe('IN_PROGRESS');
    expect(incomplete.remainingGoalIds).toEqual(['mid-branch']);
    expect(complete.status).toBe('COMPLETE');
    expect(complete.remainingGoalIds).toEqual([]);
  });

  it('does not complete a committed CHOICE from a different owned branch', () => {
    const contract = compileBuildContractV1(input([3], {
      committedChoiceItemIdsByGroup: new Map([['mid-branch', [2]]]),
    }));

    expect(contract.completedGoalIds).toEqual(new Set(['early-core']));
    expect(contract.remainingGoalIds).toEqual(['mid-branch']);
    expect(contract.status).toBe('IN_PROGRESS');
  });

  it('rebases an unplanned user purchase as temporary inventory instead of demanding an immediate sell', () => {
    const contract = compileBuildContractV1(input([99]));

    expect(contract.status).toBe('IN_PROGRESS');
    expect(contract.temporaryItemIds).toEqual(new Set([99]));
    expect(contract.replanReasonCodes).toContain('USER_DIVERGENCE_REBASED');
    expect(contract.replanReasonCodes).not.toContain('SELL_UNPLANNED_ITEM');
  });

  it('does not classify a known OPTIONAL strategy item as user divergence', () => {
    const contract = compileBuildContractV1(input([50]));

    expect(contract.temporaryItemIds).toEqual(new Set());
    expect(contract.replanReasonCodes).not.toContain('USER_DIVERGENCE_REBASED');
  });

  it('treats an owned descendant as satisfying the lower mandatory goal through lineage', () => {
    const contract = compileBuildContractV1(input([2], {
      committedChoiceItemIdsByGroup: new Map([['mid-branch', [2]]]),
    }));

    expect(contract.completedGoalIds).toEqual(new Set(['early-core', 'mid-branch']));
    expect(contract.status).toBe('COMPLETE');
  });

  it.each([
    ['LOCKED_BY_UPGRADE_COMPRESSION', 'UPGRADE_CONSUMES_COMPONENT'],
    ['LOCKED_BY_SELL', 'EXPLICIT_REPLACE_CAPACITY_PATH'],
    ['LOCKED_BY_SELL', 'TEMPORARY_ITEM_SELL_CAPACITY_PATH'],
    ['LOCKED_BY_FLEX', 'VERIFIED_FUTURE_FLEX_PREREQUISITE'],
  ] as const)('retains a full-inventory future goal with an explicit %s capacity path', (state, reason) => {
    const contract = compileBuildContractV1(input([1], {
      futureGoalTargetItemIdsByGoal: new Map([['mid-branch', [2]]]),
      slotReservations: [{
        goalId: 'mid-branch',
        targetItemId: 2,
        state,
        reasonCodes: [reason],
      }],
    }));

    expect(contract.status).toBe('IN_PROGRESS');
    expect(contract.slotReservations).toEqual([{
      goalId: 'mid-branch',
      targetItemId: 2,
      state,
      reasonCodes: [reason],
    }]);
    expect(contract.replanReasonCodes).not.toContain('MANDATORY_CAPACITY_PATH_UNRESOLVED');
  });

  it('fails closed when a mandatory future target has no explicit capacity path', () => {
    const contract = compileBuildContractV1(input([1], {
      futureGoalTargetItemIdsByGoal: new Map([['mid-branch', [2]]]),
    }));

    expect(contract.status).toBe('REPLAN_REQUIRED');
    expect(contract.slotReservations).toEqual([{
      goalId: 'mid-branch',
      targetItemId: 2,
      state: 'BLOCKED',
      reasonCodes: ['MANDATORY_CAPACITY_PATH_UNRESOLVED'],
    }]);
    expect(contract.replanReasonCodes).toContain('MANDATORY_CAPACITY_PATH_UNRESOLVED');
  });

  it('represents missing structured strategy input explicitly as out of distribution', () => {
    const contract = createOutOfDistributionBuildContractV1(['STRUCTURED_SKELETON_UNAVAILABLE']);

    expect(contract.status).toBe('OUT_OF_DISTRIBUTION');
    expect(contract.remainingGoalIds).toEqual([]);
    expect(contract.replanReasonCodes).toEqual(['STRUCTURED_SKELETON_UNAVAILABLE']);
  });
});
