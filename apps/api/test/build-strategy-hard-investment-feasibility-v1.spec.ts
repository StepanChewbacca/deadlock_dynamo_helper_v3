import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildStrategyFeasibilityV1Service } from '../src/statlocker-adaptive/build-strategy-feasibility-v1.service';
import { BuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-v1';

const catalogSha256 = 'a'.repeat(64);
const graph = createRecommendationItemGraph([
  {
    itemId: 1,
    name: 'Weapon core',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 1600,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 800, returnedItemIds: [] },
  },
  {
    itemId: 2,
    name: 'Weapon extension',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 1600,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 800, returnedItemIds: [] },
  },
]);
const slotRules = {
  baseSlots: 12,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 } as const,
  maxFlexSlots: 4,
  maxActiveItems: 4,
};
const economyRules = {
  rulesetId: 'r1',
  catalogSha256,
  ...slotRules,
  investmentBreakpoints: {
    weapon: [1600, 3200],
    vitality: [1600, 3200],
    spirit: [1600, 3200],
  },
};

function strategy(target: number): BuildStrategySpecV1 {
  return {
    schemaVersion: 1,
    strategyId: `investment-${target}`,
    heroId: 1,
    rulesetId: 'r1',
    sourcePatchId: 'p1',
    support: 1,
    stability: 1,
    representativeTraceId: 'trace',
    goals: [
      {
        goalId: 'core',
        type: 'CORE',
        phase: 'EARLY',
        targetItemIds: [1],
        minSelect: 1,
        maxSelect: 1,
        prerequisiteGoalIds: [],
        hard: true,
        lifecycleByItemId: { 1: 'PERMANENT_CORE' },
        rationaleCodes: ['CORE'],
      },
      {
        goalId: 'extension',
        type: 'CORE',
        phase: 'MID',
        targetItemIds: [2],
        minSelect: 0,
        maxSelect: 1,
        prerequisiteGoalIds: ['core'],
        hard: false,
        lifecycleByItemId: { 2: 'PERMANENT_CORE' },
        rationaleCodes: ['INVESTMENT_SUPPORT'],
      },
    ],
    branchGroups: [],
    situationalWindows: [],
    investmentPolicy: {
      objectives: [{
        objectiveId: 'weapon-target',
        type: 'weapon',
        hard: true,
        minimumValue: target,
        activateAfterGoalIds: ['core'],
        deactivateAfterGoalIds: [],
        reasonCodes: ['HARD_WEAPON_INVESTMENT'],
      }],
      preferredWeights: { weapon: 1, vitality: 0, spirit: 0 },
    },
    slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
    terminalPolicy: { requiredGoalIds: ['core'], allowWaiveSoftGoals: true },
  };
}

describe('build strategy hard investment feasibility v1', () => {
  const service = new BuildStrategyFeasibilityV1Service();

  it('uses strategy-owned soft items to satisfy an explicit hard investment objective', () => {
    const result = service.validate({
      strategy: strategy(3200),
      itemGraph: graph,
      slotRules,
      economyRules,
    });

    expect(result.feasible).toBe(true);
    expect(result.finalItemIds).toEqual([1, 2]);
  });

  it('rejects publication when the hard investment objective cannot be reached', () => {
    const result = service.validate({
      strategy: strategy(4800),
      itemGraph: graph,
      slotRules,
      economyRules,
    });

    expect(result.feasible).toBe(false);
    expect(result.failedInvestmentObjectiveId).toBe('weapon-target');
    expect(result.reasonCodes).toContain('HARD_INVESTMENT_OBJECTIVE_UNREACHABLE');
  });

  it('fails closed when hard investment semantics lack exact economy rules', () => {
    const result = service.validate({
      strategy: strategy(3200),
      itemGraph: graph,
      slotRules,
    });

    expect(result.feasible).toBe(false);
    expect(result.reasonCodes).toContain('INVESTMENT_RULES_UNKNOWN');
  });
});
