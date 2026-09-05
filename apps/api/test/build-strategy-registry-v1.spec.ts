import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildStrategyRegistryV1Service } from '../src/statlocker-adaptive/build-strategy-registry-v1.service';
import { BuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-v1';

const graph = createRecommendationItemGraph([
  { itemId: 1, name: 'A', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [] },
]);

const spec: BuildStrategySpecV1 = {
  schemaVersion: 1, strategyId: 's1', heroId: 1, rulesetId: 'r1', sourcePatchId: 'p1', support: 1, stability: 1,
  representativeTraceId: 't', goals: [{
    goalId: 'g', type: 'CORE', phase: 'EARLY', targetItemIds: [1], minSelect: 1, maxSelect: 1,
    prerequisiteGoalIds: [], hard: true, lifecycleByItemId: { 1: 'PERMANENT_CORE' }, rationaleCodes: ['CORE'],
  }], branchGroups: [], situationalWindows: [],
  investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
  slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
  terminalPolicy: { requiredGoalIds: ['g'], allowWaiveSoftGoals: true },
};

function forHero(heroId: number, strategyId: string, patchId = 'p1'): BuildStrategySpecV1 {
  return { ...spec, heroId, strategyId, sourcePatchId: patchId };
}

describe('build strategy registry v1', () => {
  it('stores validated immutable snapshots and returns defensive copies', () => {
    const registry = new BuildStrategyRegistryV1Service();
    registry.replaceSnapshot({ rulesetId: 'r1', patchId: 'p1', catalogSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64), specs: [spec], itemGraph: graph });

    const first = registry.getStrategies(1, 'r1', 'a'.repeat(64), 'p1');
    expect(first).toHaveLength(1);
    expect(first[0].strategyId).toBe('s1');
    (first as BuildStrategySpecV1[]).splice(0, 1);
    expect(registry.getStrategies(1, 'r1', 'a'.repeat(64), 'p1')).toHaveLength(1);
  });

  it('keeps independently mined heroes in the same exact scope', () => {
    const registry = new BuildStrategyRegistryV1Service();
    registry.replaceSnapshot({
      rulesetId: 'r1', patchId: 'p1', catalogSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64),
      specs: [forHero(1, 'hero-1')], itemGraph: graph,
    });
    registry.replaceSnapshot({
      rulesetId: 'r1', patchId: 'p1', catalogSha256: 'a'.repeat(64), sourceSha256: 'c'.repeat(64),
      specs: [forHero(2, 'hero-2')], itemGraph: graph,
    });

    expect(registry.getStrategies(1, 'r1', 'a'.repeat(64), 'p1').map((entry) => entry.strategyId)).toEqual(['hero-1']);
    expect(registry.getStrategies(2, 'r1', 'a'.repeat(64), 'p1').map((entry) => entry.strategyId)).toEqual(['hero-2']);
  });

  it('keeps patch scopes isolated even when ruleset and catalog identities match', () => {
    const registry = new BuildStrategyRegistryV1Service();
    registry.replaceSnapshot({
      rulesetId: 'r1', patchId: 'p1', catalogSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64),
      specs: [forHero(1, 'patch-1', 'p1')], itemGraph: graph,
    });
    registry.replaceSnapshot({
      rulesetId: 'r1', patchId: 'p2', catalogSha256: 'a'.repeat(64), sourceSha256: 'c'.repeat(64),
      specs: [forHero(1, 'patch-2', 'p2')], itemGraph: graph,
    });

    expect(registry.getStrategies(1, 'r1', 'a'.repeat(64), 'p1').map((entry) => entry.strategyId)).toEqual(['patch-1']);
    expect(registry.getStrategies(1, 'r1', 'a'.repeat(64), 'p2').map((entry) => entry.strategyId)).toEqual(['patch-2']);
    expect(registry.getStrategies(1, 'r1', 'a'.repeat(64))).toEqual([]);
  });

  it('rejects invalid specs instead of publishing partial strategy state', () => {
    const registry = new BuildStrategyRegistryV1Service();
    const invalid = { ...spec, goals: [{ ...spec.goals[0], targetItemIds: [999] }] };
    expect(() => registry.replaceSnapshot({ rulesetId: 'r1', patchId: 'p1', catalogSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64), specs: [invalid], itemGraph: graph }))
      .toThrow(/invalid strategy snapshot/i);
  });
});
