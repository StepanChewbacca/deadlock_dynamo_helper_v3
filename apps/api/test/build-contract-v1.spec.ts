import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildContractV1Service } from '../src/statlocker-adaptive/build-contract-v1.service';
import { BuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-v1';

const graph = createRecommendationItemGraph([
  {
    itemId: 1,
    name: 'Core component',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
  },
  {
    itemId: 2,
    name: 'Core upgrade',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 1_600,
    upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }],
  },
  {
    itemId: 3,
    name: 'Branch A',
    slotType: 'vitality',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 1_600,
    upgradeRecipes: [],
  },
  {
    itemId: 4,
    name: 'Branch B',
    slotType: 'vitality',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 1_600,
    upgradeRecipes: [],
  },
]);

const strategy: BuildStrategySpecV1 = {
  schemaVersion: 1,
  strategyId: 'strategy',
  heroId: 1,
  rulesetId: 'r1',
  sourcePatchId: 'p1',
  support: 0.6,
  stability: 0.8,
  representativeTraceId: 'trace',
  goals: [
    {
      goalId: 'core', type: 'CORE', phase: 'EARLY', targetItemIds: [1], minSelect: 1, maxSelect: 1,
      prerequisiteGoalIds: [], hard: true, lifecycleByItemId: { 1: 'UPGRADE_COMPONENT' }, rationaleCodes: ['CORE'],
    },
    {
      goalId: 'upgrade', type: 'UPGRADE', phase: 'MID', targetItemIds: [2], minSelect: 1, maxSelect: 1,
      prerequisiteGoalIds: ['core'], hard: true, lifecycleByItemId: { 2: 'PERMANENT_CORE' }, rationaleCodes: ['UPGRADE'],
    },
    {
      goalId: 'branch-a', type: 'BRANCH', phase: 'MID', targetItemIds: [3], minSelect: 1, maxSelect: 1,
      prerequisiteGoalIds: ['core'], hard: true, lifecycleByItemId: { 3: 'PERMANENT_CORE' }, rationaleCodes: ['BRANCH'],
    },
    {
      goalId: 'branch-b', type: 'BRANCH', phase: 'MID', targetItemIds: [4], minSelect: 1, maxSelect: 1,
      prerequisiteGoalIds: ['core'], hard: true, lifecycleByItemId: { 4: 'PERMANENT_CORE' }, rationaleCodes: ['BRANCH'],
    },
  ],
  branchGroups: [{ branchGroupId: 'defense', optionGoalIds: ['branch-a', 'branch-b'], minSelect: 1, maxSelect: 1 }],
  situationalWindows: [],
  investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 1, spirit: 0 } },
  slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
  terminalPolicy: { requiredGoalIds: ['upgrade'], allowWaiveSoftGoals: true },
};

describe('build contract v1', () => {
  const service = new BuildContractV1Service();

  it('marks an ancestor core goal satisfied when its upgrade descendant is owned', () => {
    const contract = service.resolve({ strategy, itemGraph: graph, ownedItemIds: [2], selectedBranches: { defense: 'branch-a' } });

    expect(contract.goalStates.core).toBe('SATISFIED');
    expect(contract.goalStates.upgrade).toBe('SATISFIED');
  });

  it('keeps HOLD distinct from build completion while mandatory goals remain', () => {
    const contract = service.resolve({
      strategy,
      itemGraph: graph,
      ownedItemIds: [1],
      selectedBranches: { defense: 'branch-a' },
      immediateMode: 'HOLD',
    });

    expect(contract.status).toBe('WAITING');
    expect(contract.remainingHardGoalIds).toEqual(expect.arrayContaining(['upgrade', 'branch-a']));
    expect(contract.currentGoalId).toBeDefined();
  });

  it('skips the losing branch after branch commitment', () => {
    const contract = service.resolve({
      strategy,
      itemGraph: graph,
      ownedItemIds: [1, 3],
      selectedBranches: { defense: 'branch-a' },
      committedBranches: { defense: 'branch-a' },
    });

    expect(contract.goalStates['branch-a']).toBe('SATISFIED');
    expect(contract.goalStates['branch-b']).toBe('SKIPPED');
    expect(contract.committedBranches.defense).toBe('branch-a');
  });

  it('reports COMPLETE only when terminal and selected hard obligations are satisfied', () => {
    const contract = service.resolve({
      strategy,
      itemGraph: graph,
      ownedItemIds: [2, 3],
      selectedBranches: { defense: 'branch-a' },
      committedBranches: { defense: 'branch-a' },
    });

    expect(contract.status).toBe('COMPLETE');
    expect(contract.remainingHardGoalIds).toEqual([]);
  });
});
