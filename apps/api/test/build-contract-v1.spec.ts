import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import {
  BuildContractInputV1,
  compileBuildContractV1,
} from '../src/statlocker-adaptive/build-contract-v1';
import { ConsensusSkeletonV1 } from '../src/statlocker-adaptive/statlocker-adaptive.types';

function item(itemId: number, upgradeFrom?: number) {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-a'],
    directPurchaseCost: upgradeFrom === undefined ? 800 : undefined,
    upgradeRecipes: upgradeFrom === undefined
      ? []
      : [{ recipeId: `upgrade:${itemId}`, consumedItemIds: [upgradeFrom], soulsCost: 800 }],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    maxCopies: 1,
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
        candidates: [{
          itemId: 1,
          strength: 0.9,
          coverage: 0.9,
          purchaseRate: 0.9,
          medianBuyTimeS: 240,
          timingSpreadS: 60,
          sourceProfileCount: 10,
          frequencyTier: 'CORE',
          rushEvidence: false,
        }],
        confidence: 0.9,
        inferred: false,
      },
      {
        groupId: 'mid-branch',
        phase: 'MID',
        type: 'CHOICE',
        minSelect: 1,
        maxSelect: 1,
        candidates: [2, 3].map((itemId) => ({
          itemId,
          strength: 0.8,
          coverage: 0.8,
          purchaseRate: 0.8,
          medianBuyTimeS: 900,
          timingSpreadS: 90,
          sourceProfileCount: 10,
          frequencyTier: 'CORE' as const,
          rushEvidence: false,
        })),
        confidence: 0.9,
        inferred: false,
      },
    ],
  };
}

function input(
  ownedItemIds: readonly number[],
  options: Partial<Pick<BuildContractInputV1, 'executionState' | 'committedChoiceItemIdsByGroup'>> = {},
): BuildContractInputV1 {
  return {
    skeleton: skeleton(),
    itemGraph: createRecommendationItemGraph([item(1), item(2, 1), item(3, 1), item(99)]),
    ownedItemIds,
    executionState: options.executionState ?? 'ACTIONABLE',
    committedChoiceItemIdsByGroup: options.committedChoiceItemIdsByGroup ?? new Map(),
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

  it('rebases an unplanned user purchase as temporary inventory instead of demanding an immediate sell', () => {
    const contract = compileBuildContractV1(input([99]));

    expect(contract.status).toBe('IN_PROGRESS');
    expect(contract.temporaryItemIds).toEqual(new Set([99]));
    expect(contract.replanReasonCodes).toContain('USER_DIVERGENCE_REBASED');
    expect(contract.replanReasonCodes).not.toContain('SELL_UNPLANNED_ITEM');
  });

  it('treats an owned descendant as satisfying the lower mandatory goal through lineage', () => {
    const contract = compileBuildContractV1(input([2], {
      committedChoiceItemIdsByGroup: new Map([['mid-branch', [2]]]),
    }));

    expect(contract.completedGoalIds).toEqual(new Set(['early-core', 'mid-branch']));
    expect(contract.status).toBe('COMPLETE');
  });
});
