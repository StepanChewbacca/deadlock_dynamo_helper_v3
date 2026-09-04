import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { AdaptiveChoiceResolverV1Service } from '../src/statlocker-adaptive/adaptive-choice-resolver-v1.service';
import { ConsensusBuildGroupV1 } from '../src/statlocker-adaptive/statlocker-adaptive.types';

function graph() {
  return createRecommendationItemGraph([10, 20, 30].map((itemId) => ({
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-a'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
  })));
}

function group(): ConsensusBuildGroupV1 {
  return {
    groupId: 'pick-two',
    phase: 'EARLY',
    type: 'CHOICE',
    minSelect: 2,
    maxSelect: 2,
    confidence: 1,
    inferred: false,
    candidates: [10, 20, 30].map((itemId) => ({
      itemId,
      strength: 0.8,
      coverage: 0.8,
      purchaseRate: 0.8,
      medianBuyTimeS: 300,
      timingSpreadS: 30,
      sourceProfileCount: 8,
      frequencyTier: 'CORE' as const,
      rushEvidence: false,
    })),
  };
}

function score(itemId: number) {
  return {
    itemId,
    score: itemId === 30 ? 3 : itemId === 20 ? 2 : 1,
    confidence: 1,
    completeness: 1,
    components: [],
    version: 'adaptive-evidence-scorer-v1',
  } as any;
}

describe('AdaptiveChoiceResolverV1Service K-of-N', () => {
  it('preserves an owned committed branch and fills the remaining selection slot contextually', () => {
    const resolver = new AdaptiveChoiceResolverV1Service({ scoreItem: jest.fn(score) } as any);
    const result = resolver.resolveChoice(group(), {
      scorerContext: {} as any,
      itemGraph: graph(),
      ownedItemIds: [10],
    });

    expect(result.committedItemIds).toEqual([10]);
    expect(result.selectedItemIds).toEqual([10, 30]);
    expect(result.committed).toBe(true);
    expect(result.externallyDiverged).toBe(false);
  });

  it('marks inventory as externally diverged when committed branches exceed maxSelect', () => {
    const resolver = new AdaptiveChoiceResolverV1Service({ scoreItem: jest.fn(score) } as any);
    const result = resolver.resolveChoice(group(), {
      scorerContext: {} as any,
      itemGraph: graph(),
      ownedItemIds: [10, 20, 30],
    });

    expect(result.committedItemIds).toEqual([10, 20, 30]);
    expect(result.externallyDiverged).toBe(true);
  });
});
