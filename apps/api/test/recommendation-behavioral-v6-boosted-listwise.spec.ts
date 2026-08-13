import {
  createRecommendationBehavioralV6BoostedModel,
  predictRecommendationBehavioralV6Boosted,
  recommendationBehavioralV6BoostedBaseScore,
  recommendationBehavioralV6BoostedFeatureVector,
  recommendationBehavioralV6BoostedSplitGoesLeft,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_BASE_SCORE,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_OBJECTIVE,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_PROBABILITY_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_TREE_CONTRACT,
  validateRecommendationBehavioralV6BoostedModel,
} from '../src/deadlock-live/recommendation-behavioral-v6-boosted-listwise';
import type { RecommendationProDecisionDatasetV6Row } from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';

describe('Recommendation Behavioral V6 grouped boosted listwise core', () => {
  it('uses the frozen listwise raw-propensity contracts', () => {
    const model = model();
    validateRecommendationBehavioralV6BoostedModel(model);
    expect(model.modelVersion).toBe(RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_MODEL_VERSION);
    expect(model.probabilityContract).toBe(
      RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_PROBABILITY_CONTRACT,
    );
    expect(model.objective).toBe(RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_OBJECTIVE);
    expect(model.baseScoreContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_BASE_SCORE);
    expect(model.treeContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_TREE_CONTRACT);
  });

  it.each([2, 50, 96])(
    'reproduces exact inverse-rank softmax with zero trees for %i candidates',
    (candidateCount) => {
      const value = rowWithCandidateCount(candidateCount);
      const prediction = predictRecommendationBehavioralV6Boosted(model(), value);
      const harmonic = Array.from(
        { length: candidateCount },
        (_, index) => 1 / (index + 1),
      ).reduce((sum, probability) => sum + probability, 0);

      expect(prediction.candidates).toHaveLength(candidateCount);
      expect(
        prediction.candidates.reduce(
          (sum, candidate) => sum + candidate.probability,
          0,
        ),
      ).toBeCloseTo(1, 12);
      expect(prediction.observedActionProbability).toBeCloseTo(1 / harmonic, 12);
      expect(prediction.topActionKey).toBe(value.observedActionKey);
    },
  );

  it('uses negative log rank as the base score', () => {
    expect(recommendationBehavioralV6BoostedBaseScore(1)).toBeCloseTo(0, 12);
    expect(recommendationBehavioralV6BoostedBaseScore(4)).toBeCloseTo(-Math.log(4), 12);
  });

  it('extracts deterministic fixed-shape candidate features', () => {
    const value = row();
    const first = recommendationBehavioralV6BoostedFeatureVector(
      value,
      value.candidates[0],
    );
    const second = recommendationBehavioralV6BoostedFeatureVector(
      value,
      value.candidates[0],
    );

    expect(first).toEqual(second);
    expect(first.numeric).toHaveLength(15);
    expect(first.categorical).toHaveLength(10);
    expect(first.numeric.every(Number.isFinite)).toBe(true);
    expect(first.categorical.every(Number.isSafeInteger)).toBe(true);
  });

  it('routes numeric and categorical stumps deterministically', () => {
    const value = row();
    const first = recommendationBehavioralV6BoostedFeatureVector(
      value,
      value.candidates[0],
    );
    const second = recommendationBehavioralV6BoostedFeatureVector(
      value,
      value.candidates[1],
    );

    expect(
      recommendationBehavioralV6BoostedSplitGoesLeft(
        { kind: 'NUMERIC_LE', featureIndex: 0, threshold: 1.5 },
        first,
      ),
    ).toBe(true);
    expect(
      recommendationBehavioralV6BoostedSplitGoesLeft(
        { kind: 'NUMERIC_LE', featureIndex: 0, threshold: 1.5 },
        second,
      ),
    ).toBe(false);
    expect(
      recommendationBehavioralV6BoostedSplitGoesLeft(
        { kind: 'CATEGORICAL_EQ', featureIndex: 0, categoryHash: first.categorical[0] },
        first,
      ),
    ).toBe(true);
    expect(
      recommendationBehavioralV6BoostedSplitGoesLeft(
        { kind: 'CATEGORICAL_EQ', featureIndex: 0, categoryHash: first.categorical[0] },
        second,
      ),
    ).toBe(false);
  });

  it('applies a boosted stump while preserving raw softmax normalization', () => {
    const value = row();
    const baseModel = model();
    const boostedModel = model();
    boostedModel.trees.push({
      split: { kind: 'NUMERIC_LE', featureIndex: 0, threshold: 1.5 },
      leftValue: 1,
      rightValue: -1,
      gain: 1,
      leftCandidateCount: 1,
      rightCandidateCount: 1,
      round: 1,
    });
    validateRecommendationBehavioralV6BoostedModel(boostedModel);

    const before = predictRecommendationBehavioralV6Boosted(baseModel, value);
    const after = predictRecommendationBehavioralV6Boosted(boostedModel, value);

    expect(after.observedActionProbability).toBeGreaterThan(
      before.observedActionProbability,
    );
    expect(
      after.candidates.reduce((sum, candidate) => sum + candidate.probability, 0),
    ).toBeCloseTo(1, 12);
  });
});

function model() {
  return createRecommendationBehavioralV6BoostedModel({
    learningRate: 0.1,
    leafL2: 10,
    maximumLeafValue: 1.5,
    minimumLeafCandidateCount: 100,
  });
}

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
      generatorScore: 1 / (index + 1),
      historicalCount: candidateCount - index,
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
    decisionId: 'decision-boosted-1',
    matchId: 'match-boosted-1',
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
    eligibility: {
      behavioralModel: true,
      valueModel: true,
      exclusionReasons: [],
    },
    source: {
      replayPolicyVersion: 'TEST',
      candidateGeneratorSnapshotVersion: 'TEST',
      candidateGeneratorSnapshotSha256: 'a'.repeat(64),
    },
  };
}
