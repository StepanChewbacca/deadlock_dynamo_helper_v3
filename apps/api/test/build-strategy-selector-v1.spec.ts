import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildStrategySelectorV1Service } from '../src/statlocker-adaptive/build-strategy-selector-v1.service';
import { BuildStrategySessionV1Service } from '../src/statlocker-adaptive/build-strategy-session-v1.service';
import { BuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-v1';

const graph = createRecommendationItemGraph([
  ...[1, 2, 3, 10, 11].map((itemId) => ({
    itemId, name: `I${itemId}`, slotType: 'weapon' as const, active: false,
    availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [],
  })),
]);

function strategy(id: string, path: readonly number[]): BuildStrategySpecV1 {
  return {
    schemaVersion: 1, strategyId: id, heroId: 1, rulesetId: 'r1', sourcePatchId: 'p1', support: 0.5, stability: 0.9,
    representativeTraceId: `${id}:trace`,
    goals: path.map((itemId, index) => ({
      goalId: `${id}:g${index}`, type: 'CORE' as const, phase: index < 2 ? 'EARLY' as const : 'MID' as const,
      targetItemIds: [itemId], minSelect: 1, maxSelect: 1,
      prerequisiteGoalIds: index === 0 ? [] : [`${id}:g${index - 1}`], hard: true,
      lifecycleByItemId: { [itemId]: 'PERMANENT_CORE' as const }, rationaleCodes: ['CORE'],
    })),
    branchGroups: [], situationalWindows: [],
    investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
    slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
    terminalPolicy: { requiredGoalIds: path.map((_, index) => `${id}:g${index}`), allowWaiveSoftGoals: true },
  };
}

const a = strategy('A', [1, 2, 3]);
const b = strategy('B', [1, 10, 11]);

describe('build strategy selector/session v1', () => {
  const selector = new BuildStrategySelectorV1Service();

  it('keeps shared early prefixes provisional and commits after distinctive build evidence', () => {
    const shared = selector.select({ strategies: [a, b], itemGraph: graph, ownedItemIds: [1], purchaseHistory: [{ itemId: 1, gameTimeSec: 100 }] });
    const distinct = selector.select({ strategies: [a, b], itemGraph: graph, ownedItemIds: [1, 2], purchaseHistory: [{ itemId: 1, gameTimeSec: 100 }, { itemId: 2, gameTimeSec: 250 }] });

    expect(shared.commitment).toBe('PROVISIONAL');
    expect(distinct.selectedStrategyId).toBe('A');
    expect(distinct.commitment).toBe('COMMITTED');
  });

  it('marks a state OOD when purchases conform to no strategy', () => {
    const result = selector.select({ strategies: [a, b], itemGraph: graph, ownedItemIds: [99], purchaseHistory: [{ itemId: 99, gameTimeSec: 100 }] });
    expect(result.commitment).toBe('OOD');
    expect(result.reasonCodes).toContain('NO_STRATEGY_CONFORMANCE');
  });

  it('filters candidates to the exact live hero and ruleset instead of trusting array order', () => {
    const foreignHero = { ...strategy('foreign-hero', [1, 2, 3]), heroId: 99, support: 1 };
    const foreignRuleset = { ...strategy('foreign-ruleset', [1, 2, 3]), rulesetId: 'r2', support: 1 };
    const result = selector.select({
      strategies: [foreignHero, foreignRuleset, a],
      heroId: 1,
      rulesetId: 'r1',
      itemGraph: graph,
      ownedItemIds: [1, 2],
      purchaseHistory: [{ itemId: 1, gameTimeSec: 100 }, { itemId: 2, gameTimeSec: 250 }],
    });

    expect(result.selectedStrategyId).toBe('A');
    expect(result.posteriors.map((entry) => entry.strategyId)).toEqual(['A']);
  });

  it('does not switch an already committed strategy for a small posterior fluctuation', () => {
    const session = new BuildStrategySessionV1Service();
    const result = session.reconcile({
      previous: { strategyId: 'A', commitment: 'COMMITTED', posterior: 0.74, selectedAtGameTimeSec: 250, replanReasons: [] },
      selection: {
        selectedStrategyId: 'B', commitment: 'COMMITTED',
        posteriors: [
          { strategyId: 'B', probability: 0.55, conformance: 0.7, evidenceCount: 2 },
          { strategyId: 'A', probability: 0.45, conformance: 0.65, evidenceCount: 2 },
        ],
        reasonCodes: ['BEST_POSTERIOR'],
      },
      gameTimeSec: 300,
    });

    expect(result.strategyId).toBe('A');
    expect(result.replanReasons).toContain('SWITCH_IMPROVEMENT_BELOW_COMMITTED_THRESHOLD');
  });
});
