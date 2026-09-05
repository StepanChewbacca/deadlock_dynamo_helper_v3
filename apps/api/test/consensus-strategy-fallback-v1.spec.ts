import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { ConsensusStrategyFallbackV1Service } from '../src/statlocker-adaptive/consensus-strategy-fallback-v1.service';
import { ConsensusSkeletonV1 } from '../src/statlocker-adaptive/statlocker-adaptive.types';

const graph = createRecommendationItemGraph([
  ...[1, 2, 3, 4].map((itemId) => ({
    itemId, name: `I${itemId}`, slotType: 'weapon' as const, active: false,
    availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [],
  })),
]);

const skeleton: ConsensusSkeletonV1 = {
  heroId: 1,
  profileCount: 10,
  groups: [
    { groupId: 'core', phase: 'EARLY', type: 'REQUIRED', minSelect: 1, maxSelect: 1, confidence: 0.9, inferred: false, candidates: [{ itemId: 1, strength: 0.9, coverage: 0.9, purchaseRate: 0.9, medianBuyTimeS: 200, timingSpreadS: 20, sourceProfileCount: 10, frequencyTier: 'CORE', rushEvidence: false }] },
    { groupId: 'choice', phase: 'MID', type: 'CHOICE', minSelect: 1, maxSelect: 1, confidence: 0.7, inferred: true, candidates: [
      { itemId: 2, strength: 0.7, coverage: 0.5, purchaseRate: 0.5, medianBuyTimeS: 700, timingSpreadS: 100, sourceProfileCount: 5, frequencyTier: 'FREQUENT', rushEvidence: false },
      { itemId: 3, strength: 0.68, coverage: 0.5, purchaseRate: 0.5, medianBuyTimeS: 720, timingSpreadS: 100, sourceProfileCount: 5, frequencyTier: 'FREQUENT', rushEvidence: false },
    ] },
    { groupId: 'optional', phase: 'LATE', type: 'OPTIONAL', minSelect: 0, maxSelect: 1, confidence: 0.4, inferred: true, candidates: [{ itemId: 4, strength: 0.4, coverage: 0.2, purchaseRate: 0.2, medianBuyTimeS: 1800, timingSpreadS: 300, sourceProfileCount: 2, frequencyTier: 'FLEX', rushEvidence: false }] },
  ],
};

describe('consensus strategy fallback v1', () => {
  it('preserves CHOICE as a branch instead of requiring both candidates', () => {
    const spec = new ConsensusStrategyFallbackV1Service().compile(skeleton, graph, 'r1', 'patch');
    expect(spec.branchGroups).toHaveLength(1);
    const branchGoals = spec.branchGroups[0].optionGoalIds.map((id) => spec.goals.find((goal) => goal.goalId === id)!);
    expect(branchGoals.map((goal) => goal.targetItemIds[0]).sort((a, b) => a - b)).toEqual([2, 3]);
    expect(spec.terminalPolicy.requiredGoalIds).not.toEqual(expect.arrayContaining(spec.branchGroups[0].optionGoalIds));
  });

  it('keeps optional candidates soft and marks the fallback as lower-stability evidence', () => {
    const spec = new ConsensusStrategyFallbackV1Service().compile(skeleton, graph, 'r1', 'patch');
    const optional = spec.goals.find((goal) => goal.targetItemIds.includes(4));
    expect(optional?.hard).toBe(false);
    expect(spec.stability).toBeLessThan(0.7);
  });
});
