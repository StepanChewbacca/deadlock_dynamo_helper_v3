import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import {
  ADAPTIVE_UNIVERSAL_SLOT_RULES_V1,
  deriveAdaptiveSlotStateV1,
} from '../src/statlocker-adaptive/adaptive-economy-v1';
import { BuildSlotPlannerV1Service } from '../src/statlocker-adaptive/build-slot-planner-v1.service';
import { BuildContractV1, BuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-v1';

const graph = createRecommendationItemGraph([{
  itemId: 1,
  name: 'Active Target',
  slotType: 'weapon',
  active: true,
  availableRulesetIds: ['r1'],
  directPurchaseCost: 800,
  upgradeRecipes: [],
  sellTransition: { soulsRefund: 400, returnedItemIds: [] },
  maxCopies: 1,
}]);

const strategy: BuildStrategySpecV1 = {
  schemaVersion: 1,
  strategyId: 'active-evidence', heroId: 1, rulesetId: 'r1', sourcePatchId: 'p', support: 1, stability: 1,
  representativeTraceId: 'trace',
  goals: [{
    goalId: 'target', type: 'CORE', phase: 'MID', targetItemIds: [1], minSelect: 1, maxSelect: 1,
    prerequisiteGoalIds: [], hard: true, lifecycleByItemId: { 1: 'PERMANENT_CORE' }, rationaleCodes: ['CORE'],
  }],
  branchGroups: [], situationalWindows: [],
  investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
  slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
  terminalPolicy: { requiredGoalIds: ['target'], allowWaiveSoftGoals: true },
};

const contract: BuildContractV1 = {
  strategyId: strategy.strategyId,
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

describe('build slot planner active-capacity evidence', () => {
  it('does not claim an active-item path fits when the active capacity is only an unverified numeric fallback', () => {
    const slots = deriveAdaptiveSlotStateV1(
      [],
      graph,
      ADAPTIVE_UNIVERSAL_SLOT_RULES_V1,
      { unlockedFlexSlots: 0, evidence: 'OBSERVED' },
    );
    const planner = new BuildSlotPlannerV1Service();

    expect(slots.mechanicsEvidence).toBe('UNKNOWN');
    expect(planner.canFit([1], { strategy, contract, itemGraph: graph, ownedItemIds: [], slots })).toBe(false);
    expect(planner.plan({ strategy, contract, itemGraph: graph, ownedItemIds: [], slots }).futureTransitions[0])
      .toMatchObject({ targetItemId: 1, requirement: 'BLOCKED' });
  });
});
