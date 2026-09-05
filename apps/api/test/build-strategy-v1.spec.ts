import {
  buildStrategyGoalMapV1,
  hardStrategyGoalIdsV1,
  phaseOrderBuildStrategyV1,
  BuildStrategySpecV1,
} from '../src/statlocker-adaptive/build-strategy-v1';

const strategy: BuildStrategySpecV1 = {
  schemaVersion: 1,
  strategyId: 'hero-1:gun:v1',
  heroId: 1,
  rulesetId: 'r1',
  sourcePatchId: 'patch-1',
  support: 0.62,
  stability: 0.84,
  representativeTraceId: 'trace-medoid',
  goals: [
    {
      goalId: 'early-core',
      type: 'CORE',
      phase: 'EARLY',
      targetItemIds: [1],
      minSelect: 1,
      maxSelect: 1,
      prerequisiteGoalIds: [],
      hard: true,
      lifecycleByItemId: { 1: 'UPGRADE_COMPONENT' },
      rationaleCodes: ['CORE_PATH'],
    },
    {
      goalId: 'late-upgrade',
      type: 'UPGRADE',
      phase: 'LATE',
      targetItemIds: [2],
      minSelect: 1,
      maxSelect: 1,
      prerequisiteGoalIds: ['early-core'],
      hard: true,
      lifecycleByItemId: { 2: 'PERMANENT_CORE' },
      rationaleCodes: ['CORE_UPGRADE'],
    },
    {
      goalId: 'optional-utility',
      type: 'CORE',
      phase: 'MID',
      targetItemIds: [3],
      minSelect: 0,
      maxSelect: 1,
      prerequisiteGoalIds: ['early-core'],
      hard: false,
      lifecycleByItemId: { 3: 'TEMPORARY_EARLY' },
      rationaleCodes: ['SOFT_UTILITY'],
    },
  ],
  branchGroups: [],
  situationalWindows: [],
  investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
  slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 1 },
  terminalPolicy: { requiredGoalIds: ['early-core', 'late-upgrade'], allowWaiveSoftGoals: true },
};

describe('build strategy v1 domain', () => {
  it('orders strategy phases deterministically', () => {
    expect(phaseOrderBuildStrategyV1('EARLY')).toBeLessThan(phaseOrderBuildStrategyV1('MID'));
    expect(phaseOrderBuildStrategyV1('MID')).toBeLessThan(phaseOrderBuildStrategyV1('LATE'));
  });

  it('returns only hard goal ids in stable declaration order', () => {
    expect(hardStrategyGoalIdsV1(strategy)).toEqual(['early-core', 'late-upgrade']);
  });

  it('builds a goal lookup without mutating the strategy', () => {
    const goals = buildStrategyGoalMapV1(strategy);
    expect(goals.get('late-upgrade')?.prerequisiteGoalIds).toEqual(['early-core']);
    expect(strategy.goals).toHaveLength(3);
  });
});
