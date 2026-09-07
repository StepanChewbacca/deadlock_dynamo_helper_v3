import { compareBuildArchetypeMiningMethodsV1 } from '../src/statlocker-adaptive/build-archetype-mining-diagnostics-v1';

function observation(
  decisionId: string,
  targets: number[],
  terminalOwnedItemIds: number[],
  rulesetId = 'ruleset-a',
) {
  return {
    heroId: 10,
    rulesetId,
    catalogSha256: 'a'.repeat(64),
    itemGraph: {} as any,
    trajectory: {
      decisionId,
      heroId: 10,
      rulesetId,
      catalogSha256: 'a'.repeat(64),
      terminalOwnedItemIds,
      steps: targets.map((targetItemId, index) => ({
        index,
        targetItemId,
        goalId: `goal-${index}`,
        gameTimeSec: 200 + index * 400,
      })),
      terminalContract: {
        committedChoiceItemIdsByGroup: new Map(),
        situationalWindowStates: [],
      },
    },
  } as any;
}

describe('compareBuildArchetypeMiningMethodsV1', () => {
  it('compares feature-vector, sequence-aware and hierarchical baselines without outcome features', () => {
    const comparison = compareBuildArchetypeMiningMethodsV1([
      observation('a', [1, 2, 3], [3]),
      observation('b', [1, 2, 3], [3]),
      observation('noise', [9, 8], [8]),
      observation('other-scope', [1, 2, 3], [3], 'ruleset-b'),
    ]);

    expect(comparison.observationCount).toBe(4);
    expect(comparison.methods.map((entry) => entry.method)).toEqual([
      'FEATURE_VECTOR',
      'SEQUENCE_AWARE',
      'HIERARCHICAL_BASELINE',
    ]);
    for (const method of comparison.methods) {
      expect(method.scopeCount).toBe(2);
      expect(method.stableClusterCount).toBe(1);
      expect(method.noiseCount).toBe(2);
      expect(method.meanWithinClusterDistance).toBe(0);
    }
  });
});