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
    const value = createModel();
    validateRecommendationBehavioralV6BoostedModel(value);
    expect(value.modelVersion).toBe(RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_MODEL_VERSION);
    expect(value.probabilityContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_PROBABILITY_CONTRACT);
    expect(value.objective).toBe(RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_OBJECTIVE);
    expect(value.baseScoreContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_BASE_SCORE);
    expect(value.treeContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_TREE_CONTRACT);
  });

  it.each([2, 50, 96])(
    'reproduces inverse-rank raw softmax with zero trees for %i candidates',
    (candidateCount) => {
      const value = rowWithCandidateCount(candidateCount);
      const prediction = predictRecommendationBehavioralV6Boosted(createModel(), value);
      const harmonic = Array.from({ length: candidateCount }, (_, index) => 1 / (index + 1))
        .reduce((sum, weight) => sum + weight, 0);

      expect(prediction.candidates).toHaveLength(candidateCount);
      expect(prediction.candidates.reduce((sum, candidate) => sum + candidate.probability, 0)).toBeCloseTo(1, 12);
      expect(prediction.observedActionProbability).toBeCloseTo(1 / harmonic, 12);
      expect(prediction.topActionKey).toBe(value.observedActionKey);
    },
  );

  it('uses negative log rank as the frozen base score', () => {
    expect(recommendationBehavioralV6BoostedBaseScore(1)).toBeCloseTo(0, 12);
    expect(recommendationBehavioralV6BoostedBaseScore(4)).toBeCloseTo(-Math.log(4), 12);
  });

  it('extracts deterministic fixed-shape features and routes stumps', () => {
    const value = row();
    const first = recommendationBehavioralV6BoostedFeatureVector(value, value.candidates[0]);
    const repeated = recommendationBehavioralV6BoostedFeatureVector(value, value.candidates[0]);
    const second = recommendationBehavioralV6BoostedFeatureVector(value, value.candidates[1]);

    expect(first).toEqual(repeated);
    expect(first.numeric).toHaveLength(15);
    expect(first.categorical).toHaveLength(10);
    expect(first.numeric.every(Number.isFinite)).toBe(true);
    expect(first.categorical.every(Number.isSafeInteger)).toBe(true);
    expect(recommendationBehavioralV6BoostedSplitGoesLeft(
      { kind: 'NUMERIC_LE', featureIndex: 0, threshold: 1.5 },
      first,
    )).toBe(true);
    expect(recommendationBehavioralV6BoostedSplitGoesLeft(
      { kind: 'NUMERIC_LE', featureIndex: 0, threshold: 1.5 },
      second,
    )).toBe(false);
    expect(recommendationBehavioralV6BoostedSplitGoesLeft(
      { kind: 'CATEGORICAL_EQ', featureIndex: 0, categoryHash: first.categorical[0] },
      first,
    )).toBe(true);
  });

  it('applies boosted residuals while keeping raw softmax normalized', () => {
    const value = row();
    const base = createModel();
    const boosted = createModel();
    boosted.trees.push({
      split: { kind: 'NUMERIC_LE', featureIndex: 0, threshold: 1.5 },
      leftValue: 1,
      rightValue: -1,
      gain: 1,
      leftCandidateCount: 1,
      rightCandidateCount: 1,
      round: 1,
    });
    validateRecommendationBehavioralV6BoostedModel(boosted);

    const before = predictRecommendationBehavioralV6Boosted(base, value);
    const after = predictRecommendationBehavioralV6Boosted(boosted, value);
    expect(after.observedActionProbability).toBeGreaterThan(before.observedActionProbability);
    expect(after.candidates.reduce((sum, candidate) => sum + candidate.probability, 0)).toBeCloseTo(1, 12);
  });
});

function createModel() {
  return createRecommendationBehavioralV6BoostedModel({
    learningRate: 0.1,
    leafL2: 10,
    maximumLeafValue: 1.5,
    minimumLeafCandidateCount: 100,
  });
}

function rowWithCandidateCount(candidateCount: number): RecommendationProDecisionDatasetV6Row {
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
    candidates: [candidate(1002, 1, 0.6, 'WEAPON'), candidate(1003, 2, 0.4, 'VITALITY')],
    observedActionKey: 'BUY:1002',
    observedActionInCandidateSet: true,
    eligibility: {
      stateModel: true,
      actionModel: true,
      behavioralModel: true,
      exclusionReasons: [],
    },
  };
}

function candidate(itemId: number, rank: number, probability: number, slotType: string) {
  return {
    actionKey: `BUY:${itemId}`,
    actionType: 'BUY' as const,
    itemId,
    rank,
    generatorScore: probability,
    historicalCount: Math.round(probability * 20),
    historicalProbability: probability,
    confidence: 0.8,
    predictedStateKey: `1001x1|${itemId}x1`,
    catalogMetadataAvailable: true,
    cost: 1_250,
    tier: 2,
    slotType,
    itemType: 'UPGRADE',
    isActiveItem: false,
    tags: [],
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
  };
}
