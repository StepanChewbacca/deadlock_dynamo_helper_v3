import { BuildInvestmentPolicyV1Service } from '../src/statlocker-adaptive/build-investment-policy-v1.service';
import { AdaptiveInvestmentStateV1 } from '../src/statlocker-adaptive/adaptive-economy-v1';
import { BuildContractV1, BuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-v1';

const strategy: BuildStrategySpecV1 = {
  schemaVersion: 1, strategyId: 's', heroId: 1, rulesetId: 'r1', sourcePatchId: 'p', support: 1, stability: 1,
  representativeTraceId: 't',
  goals: [{
    goalId: 'core', type: 'CORE', phase: 'EARLY', targetItemIds: [1], minSelect: 1, maxSelect: 1,
    prerequisiteGoalIds: [], hard: true, lifecycleByItemId: { 1: 'PERMANENT_CORE' }, rationaleCodes: ['CORE'],
  }],
  branchGroups: [], situationalWindows: [],
  investmentPolicy: {
    objectives: [{
      objectiveId: 'weapon-4800', type: 'weapon', hard: true, targetBreakpoint: 4800,
      activateAfterGoalIds: ['core'], deactivateAfterGoalIds: [], reasonCodes: ['CORE_WEAPON_INVESTMENT'],
    }],
    preferredWeights: { weapon: 0.7, vitality: 0.3, spirit: 0 },
  },
  slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
  terminalPolicy: { requiredGoalIds: ['core'], allowWaiveSoftGoals: true },
};

function contract(coreState: 'ACTIVE' | 'SATISFIED'): BuildContractV1 {
  return {
    strategyId: 's', status: 'IN_PROGRESS', commitment: 'COMMITTED', currentGoalId: coreState === 'ACTIVE' ? 'core' : undefined,
    goalStates: { core: coreState }, selectedBranches: {}, committedBranches: {}, temporaryItemIds: [],
    reservedSituationalWindowIds: [], remainingHardGoalIds: coreState === 'SATISFIED' ? [] : ['core'], completionReasonCodes: [],
  };
}

function investment(weapon: number): AdaptiveInvestmentStateV1 {
  return {
    evidence: 'RECONSTRUCTED',
    tracks: {
      weapon: { type: 'weapon', currentValue: weapon, achievedBreakpoint: weapon >= 3200 ? 3200 : undefined, nextBreakpoint: weapon < 4800 ? 4800 : 6400, soulsToNextBreakpoint: weapon < 4800 ? 4800 - weapon : 6400 - weapon },
      vitality: { type: 'vitality', currentValue: 1600 },
      spirit: { type: 'spirit', currentValue: 0 },
    },
  };
}

describe('build investment policy v1', () => {
  const service = new BuildInvestmentPolicyV1Service();

  it('locks an objective until its strategic prerequisites are satisfied', () => {
    const plan = service.resolve({ strategy, contract: contract('ACTIVE'), investment: investment(3200) });
    expect(plan.objectives[0].state).toBe('LOCKED');
  });

  it('activates the explicit 4800 objective without implicitly chasing every later breakpoint', () => {
    const plan = service.resolve({ strategy, contract: contract('SATISFIED'), investment: investment(3200) });
    expect(plan.objectives[0]).toMatchObject({ state: 'ACTIVE', currentValue: 3200, targetValue: 4800, distance: 1600 });
    expect(plan.activeObjectiveIds).toEqual(['weapon-4800']);
  });

  it('marks the explicit objective satisfied once reached', () => {
    const plan = service.resolve({ strategy, contract: contract('SATISFIED'), investment: investment(4800) });
    expect(plan.objectives[0].state).toBe('SATISFIED');
    expect(plan.activeObjectiveIds).toEqual([]);
  });
});
