import {
  cloneRecommendationBehavioralV52Model,
  createRecommendationBehavioralV52Model,
  predictRecommendationBehavioralV52,
  recommendationBehavioralV52FeatureCounts,
  recommendationBehavioralV52FoldId,
  RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
  RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
  stabilizeRecommendationBehavioralV52ObservedProbability,
  trainRecommendationBehavioralV52Decision,
  validateRecommendationBehavioralV52Model,
} from '../src/deadlock-live/recommendation-behavioral-v5-2';
import type { RecommendationProDecisionDatasetV6Row } from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';

const MODEL_CONFIG = {
  linearHashDimension: 1_024,
  embeddingHashDimension: 512,
  latentDimension: 8,
};

describe('Recommendation Behavioral V5.2 core', () => {
  it('initializes deterministically under the new artifact contract', () => {
    const first = createRecommendationBehavioralV52Model(MODEL_CONFIG);
    const second = createRecommendationBehavioralV52Model(MODEL_CONFIG);

    expect(first).toEqual(second);
    expect(first.modelVersion).toBe(RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION);
    expect(first.featureVersion).toBe(RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION);
    expect(first.probabilityContract).toBe(
      RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
    );
    expect(first.contextEmbeddings.every((value) => value === 0)).toBe(true);
    expect(first.candidateEmbeddings.some((value) => value !== 0)).toBe(true);
  });

  it.each([2, 50, 139, 200])(
    'keeps the %i-candidate distribution raw while clipping only the observed propensity',
    (candidateCount) => {
      const model = createRecommendationBehavioralV52Model(MODEL_CONFIG);
      const prediction = predictRecommendationBehavioralV52(
        model,
        rowWithCandidateCount(candidateCount),
      );
      const rawObservedProbability = 1 / candidateCount;
      const clippedObservedProbability =
        stabilizeRecommendationBehavioralV52ObservedProbability(
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

  it('learns a repeatedly observed candidate and activates low-rank interactions', () => {
    const model = createRecommendationBehavioralV52Model(MODEL_CONFIG);
    const trainingRow = row();

    for (let index = 0; index < 300; index += 1) {
      trainRecommendationBehavioralV52Decision(model, trainingRow, {
        learningRate: 0.2,
        l2: 0.0001,
      });
    }

    const prediction = predictRecommendationBehavioralV52(model, trainingRow);
    const observed = prediction.candidates.find(
      (candidate) => candidate.actionKey === trainingRow.observedActionKey,
    );

    expect(prediction.topActionKey).toBe(trainingRow.observedActionKey);
    expect(prediction.observedActionProbability).toBeGreaterThan(0.8);
    expect(Math.abs(observed?.interactionScore ?? 0)).toBeGreaterThan(1e-8);
    expect(model.trainedDecisionCount).toBe(300);
  });

  it('learns opposite context-candidate interaction margins for different heroes', () => {
    const model = createRecommendationBehavioralV52Model({
      ...MODEL_CONFIG,
      linearHashDimension: 4_096,
      embeddingHashDimension: 2_048,
    });
    const heroOne = row();
    const heroTwo = row();
    heroTwo.decisionId = 'decision-2';
    heroTwo.matchId = 'match-2';
    heroTwo.state.heroId = 2;
    heroTwo.observedActionKey = 'BUY:1003';

    for (let index = 0; index < 500; index += 1) {
      trainRecommendationBehavioralV52Decision(model, heroOne, {
        learningRate: 0.15,
        l2: 0.0001,
      });
      trainRecommendationBehavioralV52Decision(model, heroTwo, {
        learningRate: 0.15,
        l2: 0.0001,
      });
    }

    const firstPrediction = predictRecommendationBehavioralV52(model, heroOne);
    const secondPrediction = predictRecommendationBehavioralV52(model, heroTwo);
    const firstByAction = new Map(
      firstPrediction.candidates.map((candidate) => [
        candidate.actionKey,
        candidate.interactionScore,
      ]),
    );
    const secondByAction = new Map(
      secondPrediction.candidates.map((candidate) => [
        candidate.actionKey,
        candidate.interactionScore,
      ]),
    );
    const firstMargin =
      (firstByAction.get('BUY:1002') ?? 0) -
      (firstByAction.get('BUY:1003') ?? 0);
    const secondMargin =
      (secondByAction.get('BUY:1002') ?? 0) -
      (secondByAction.get('BUY:1003') ?? 0);

    expect(firstPrediction.topActionKey).toBe('BUY:1002');
    expect(secondPrediction.topActionKey).toBe('BUY:1003');
    expect(firstMargin).toBeGreaterThan(0);
    expect(secondMargin).toBeLessThan(0);
  });

  it('clones low-rank parameters without sharing mutable arrays', () => {
    const model = createRecommendationBehavioralV52Model(MODEL_CONFIG);
    trainRecommendationBehavioralV52Decision(model, row(), {
      learningRate: 0.2,
      l2: 0.0001,
    });
    const clone = cloneRecommendationBehavioralV52Model(model);

    validateRecommendationBehavioralV52Model(clone);
    clone.linearWeights[0] += 1;
    clone.contextEmbeddings[0] += 1;
    clone.candidateEmbeddings[0] += 1;

    expect(clone.linearWeights[0]).not.toBe(model.linearWeights[0]);
    expect(clone.contextEmbeddings[0]).not.toBe(model.contextEmbeddings[0]);
    expect(clone.candidateEmbeddings[0]).not.toBe(model.candidateEmbeddings[0]);
  });

  it('materializes separate linear, context, and candidate feature families', () => {
    const model = createRecommendationBehavioralV52Model(MODEL_CONFIG);
    const value = row();
    const counts = recommendationBehavioralV52FeatureCounts(
      value,
      value.candidates[0],
      model,
    );

    expect(counts.linear).toBeGreaterThan(24);
    expect(counts.contextTower).toBeGreaterThan(12);
    expect(counts.candidateTower).toBeGreaterThan(8);
  });

  it('keeps MATCH-level fold assignment deterministic', () => {
    expect(recommendationBehavioralV52FoldId('match-1', 5)).toBe(
      recommendationBehavioralV52FoldId('match-1', 5),
    );
    expect(recommendationBehavioralV52FoldId('match-1', 5)).toBeGreaterThanOrEqual(0);
    expect(recommendationBehavioralV52FoldId('match-1', 5)).toBeLessThan(5);
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
      componentItemIds: [],
      tags: [],
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
