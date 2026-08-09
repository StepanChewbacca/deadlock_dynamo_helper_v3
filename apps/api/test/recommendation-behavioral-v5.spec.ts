import {
  createRecommendationBehavioralV5Model,
  predictRecommendationBehavioralV5,
  recommendationBehavioralV5DiagnosticMatchSelected,
  recommendationBehavioralV5FeatureCount,
  recommendationBehavioralV5FoldId,
  stabilizeRecommendationBehavioralV5ObservedProbability,
  trainRecommendationBehavioralV5Decision,
} from '../src/deadlock-live/recommendation-behavioral-v5';
import type { RecommendationProDecisionDatasetV6Row } from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';

describe('Recommendation Behavioral V5 core', () => {
  it('selects bounded diagnostic samples deterministically at match level', () => {
    const selected = recommendationBehavioralV5DiagnosticMatchSelected(
      'match-1',
      64,
      0,
    );
    expect(
      recommendationBehavioralV5DiagnosticMatchSelected('match-1', 64, 0),
    ).toBe(selected);
    expect(() =>
      recommendationBehavioralV5DiagnosticMatchSelected('match-1', 64, 64),
    ).toThrow('remainder');
  });

  it('assigns a deterministic match-level fold', () => {
    expect(recommendationBehavioralV5FoldId('match-1', 5)).toBe(
      recommendationBehavioralV5FoldId('match-1', 5),
    );
    expect(recommendationBehavioralV5FoldId('match-1', 5)).toBeGreaterThanOrEqual(0);
    expect(recommendationBehavioralV5FoldId('match-1', 5)).toBeLessThan(5);
  });

  it('produces a normalized candidate-set softmax', () => {
    const model = createRecommendationBehavioralV5Model(512);
    const prediction = predictRecommendationBehavioralV5(model, row());

    expect(prediction.candidates).toHaveLength(2);
    expect(
      prediction.candidates.reduce(
        (sum, candidate) => sum + candidate.probability,
        0,
      ),
    ).toBeCloseTo(1, 12);
    expect(prediction.observedActionProbability).toBeCloseTo(0.5, 12);
    expect(prediction.maximumProbability).toBeCloseTo(0.5, 12);
  });

  it.each([2, 50, 139, 200])(
    'keeps %i-candidate softmax raw while clipping only the observed propensity',
    (candidateCount) => {
      const model = createRecommendationBehavioralV5Model(512);
      const prediction = predictRecommendationBehavioralV5(
        model,
        rowWithCandidateCount(candidateCount),
      );
      const rawObservedProbability = 1 / candidateCount;
      const clippedObservedProbability =
        stabilizeRecommendationBehavioralV5ObservedProbability(
          prediction.observedActionProbability,
          0.02,
        );

      expect(prediction.candidates).toHaveLength(candidateCount);
      expect(
        prediction.candidates.reduce(
          (sum, candidate) => sum + candidate.probability,
          0,
        ),
      ).toBeCloseTo(1, 12);
      expect(prediction.observedActionProbability).toBeCloseTo(
        rawObservedProbability,
        12,
      );
      expect(clippedObservedProbability).toBeCloseTo(
        Math.max(rawObservedProbability, 0.02),
        12,
      );
      expect(
        prediction.candidates.reduce(
          (sum, candidate) => sum + candidate.probability,
          0,
        ),
      ).toBeCloseTo(1, 12);
    },
  );

  it('learns the observed candidate without using outcome fields', () => {
    const model = createRecommendationBehavioralV5Model(1_024);
    const trainingRow = row();
    for (let index = 0; index < 200; index += 1) {
      trainRecommendationBehavioralV5Decision(model, trainingRow, {
        learningRate: 0.5,
        l2: 0.0001,
      });
    }

    const prediction = predictRecommendationBehavioralV5(model, trainingRow);
    expect(prediction.topActionKey).toBe('BUY:1002');
    expect(prediction.observedActionProbability).toBeGreaterThan(0.8);
    expect(model.trainedDecisionCount).toBe(200);
  });

  it('materializes candidate-specific state interactions', () => {
    const value = row();
    const first = recommendationBehavioralV5FeatureCount(
      value,
      value.candidates[0],
      1_024,
    );
    const second = recommendationBehavioralV5FeatureCount(
      value,
      value.candidates[1],
      1_024,
    );

    expect(first).toBeGreaterThan(24);
    expect(second).toBeGreaterThan(24);
  });
});

function rowWithCandidateCount(
  candidateCount: number,
): RecommendationProDecisionDatasetV6Row {
  const value = row();
  const template = value.candidates[0];
  value.candidates = Array.from({ length: candidateCount }, (_, index) => {
    const itemId = 1002 + index;
    return {
      ...template,
      actionKey: `BUY:${itemId}`,
      itemId,
      rank: index + 1,
      generatorScore: 1 / candidateCount,
      historicalCount: candidateCount,
      historicalProbability: 1 / candidateCount,
      predictedStateKey: `1001x1|${itemId}x1`,
    };
  });
  value.observedActionKey = value.candidates[0].actionKey;
  return value;
}

function row(): RecommendationProDecisionDatasetV6Row {
  return {
    schemaVersion: 1,
    datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
    dataSource: 'PRO_HISTORICAL',
    decisionSource: 'HISTORICAL_REPLAY',
    decisionId: 'decision-1',
    matchId: 'match-1',
    matchStartTime: '2026-07-01T00:00:00.000Z',
    playerId: 'player-1',
    split: 'TRAIN',
    state: {
      heroId: 1,
      team: 0,
      phase: 'EARLY',
      gameTimeS: 600,
      inventoryStateKey: '1001x1',
      inventoryItemCounts: [{ itemId: 1001, count: 1 }],
      previousActionKeys: ['BUY:1001'],
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
      inventoryTagCounts: { COMPONENT: 1 },
      timelineJoined: true,
      timelineSnapshotLagS: 5,
      kills: 2,
      deaths: 1,
      assists: 4,
      netWorth: 5_000,
      heroDamage: 3_500,
      health: 900,
      maxHealth: 1_200,
      level: 8,
    },
    candidates: [
      {
        actionKey: 'BUY:1002',
        actionType: 'BUY',
        itemId: 1002,
        rank: 1,
        generatorScore: 0.6,
        historicalCount: 12,
        historicalProbability: 0.6,
        confidence: 0.8,
        predictedStateKey: '1001x1|1002x1',
        catalogMetadataAvailable: true,
        cost: 1_250,
        tier: 2,
        slotType: 'WEAPON',
        itemType: 'UPGRADE',
        isActiveItem: false,
        tags: ['DAMAGE'],
        componentItemIds: [1001],
        requiredComponentCount: 1,
        ownedComponentCount: 1,
        missingComponentCount: 0,
        hasAnyOwnedComponent: true,
        hasCompleteRecipeComponents: true,
        alreadyOwnedCount: 0,
        sameSlotOwnedItemCount: 1,
        inventoryTagOverlapCount: 0,
        previousActionCount: 0,
        currentNetWorth: 5_000,
        costToNetWorthRatio: 0.25,
      },
      {
        actionKey: 'BUY:1003',
        actionType: 'BUY',
        itemId: 1003,
        rank: 2,
        generatorScore: 0.4,
        historicalCount: 8,
        historicalProbability: 0.4,
        confidence: 0.7,
        predictedStateKey: '1001x1|1003x1',
        catalogMetadataAvailable: true,
        cost: 1_250,
        tier: 2,
        slotType: 'VITALITY',
        itemType: 'UPGRADE',
        isActiveItem: true,
        activationType: 'INSTANT',
        tags: ['VITALITY'],
        componentItemIds: [],
        requiredComponentCount: 0,
        ownedComponentCount: 0,
        missingComponentCount: 0,
        hasAnyOwnedComponent: false,
        hasCompleteRecipeComponents: false,
        alreadyOwnedCount: 0,
        sameSlotOwnedItemCount: 0,
        inventoryTagOverlapCount: 0,
        previousActionCount: 0,
        currentNetWorth: 5_000,
        costToNetWorthRatio: 0.25,
      },
    ],
    observedActionKey: 'BUY:1002',
    observedActionInCandidateSet: true,
    shortHorizonOutcomes: {
      threeMinutes: 0.1,
      fiveMinutes: 0.2,
      tenMinutes: 0.3,
    },
    finalOutcome: 1,
    versions: {
      catalog: 'catalog-1',
      catalogSha256: 'a'.repeat(64),
      candidateGenerator: 'generator-1',
      candidateGeneratorPolicy: 'policy-1',
      candidateGeneratorPolicySha256: 'b'.repeat(64),
      stateFeatures: 'RECOMMENDATION_STATE_FEATURES_V6_2_FUTURE_TIMELINE_FALLBACK',
      replay: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2',
    },
    eligibility: {
      stateModel: true,
      behavioralModel: true,
      actionModel: true,
      exclusionReasons: [],
    },
  };
}
