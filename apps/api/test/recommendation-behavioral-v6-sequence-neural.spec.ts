import {
  createRecommendationBehavioralV6SequenceModel,
  predictRecommendationBehavioralV6Sequence,
  recommendationBehavioralV6SequenceBaseScore,
  recommendationBehavioralV6SequenceHistoryTokens,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_BASE_SCORE,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_ENCODER,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OBJECTIVE,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OPTIMIZER,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_PROBABILITY_CONTRACT,
  trainRecommendationBehavioralV6SequenceDecision,
  validateRecommendationBehavioralV6SequenceModel,
} from '../src/deadlock-live/recommendation-behavioral-v6-sequence-neural';
import type { RecommendationProDecisionDatasetV6Row } from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';

describe('Recommendation Behavioral V6 sequence neural core', () => {
  it('uses frozen ordered-history raw-propensity contracts', () => {
    const value = model();
    validateRecommendationBehavioralV6SequenceModel(value);
    expect(value.modelVersion).toBe(RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_MODEL_VERSION);
    expect(value.probabilityContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_PROBABILITY_CONTRACT);
    expect(value.objective).toBe(RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OBJECTIVE);
    expect(value.baseScoreContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_BASE_SCORE);
    expect(value.encoderContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_ENCODER);
    expect(value.optimizerContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OPTIMIZER);
  });

  it('uses negative log rank as the explicit support-oriented base score', () => {
    expect(recommendationBehavioralV6SequenceBaseScore(1)).toBeCloseTo(0, 12);
    expect(recommendationBehavioralV6SequenceBaseScore(8)).toBeCloseTo(-Math.log(8), 12);
  });

  it('keeps only the most recent ordered history window', () => {
    const value = row();
    value.state.previousActionKeys = Array.from({ length: 20 }, (_, index) => `BUY:${1000 + index}`);
    const tokens = recommendationBehavioralV6SequenceHistoryTokens(model(), value);
    expect(tokens).toHaveLength(16);
    expect(tokens[0]).toBe('BUY:1004');
    expect(tokens[15]).toBe('BUY:1019');
  });

  it('is deterministic but sensitive to action order', () => {
    const forward = row();
    forward.state.previousActionKeys = ['BUY:1001', 'BUY:1002', 'BUY:1003'];
    const reversed = row();
    reversed.state.previousActionKeys = ['BUY:1003', 'BUY:1002', 'BUY:1001'];
    const firstModel = model();
    const secondModel = model();

    const forwardPrediction = predictRecommendationBehavioralV6Sequence(firstModel, forward);
    const repeatedPrediction = predictRecommendationBehavioralV6Sequence(secondModel, forward);
    const reversedPrediction = predictRecommendationBehavioralV6Sequence(firstModel, reversed);

    expect(forwardPrediction).toEqual(repeatedPrediction);
    expect(reversedPrediction.candidates.map((candidate) => candidate.probability)).not.toEqual(
      forwardPrediction.candidates.map((candidate) => candidate.probability),
    );
  });

  it.each([2, 50, 96])('preserves raw softmax normalization for %i candidates', (count) => {
    const value = rowWithCandidateCount(count);
    const prediction = predictRecommendationBehavioralV6Sequence(model(), value);
    expect(prediction.candidates).toHaveLength(count);
    expect(prediction.candidates.reduce((sum, candidate) => sum + candidate.probability, 0)).toBeCloseTo(1, 12);
    expect(prediction.candidates.every((candidate) => candidate.probability > 0)).toBe(true);
  });

  it('updates sequence/candidate parameters from grouped softmax error', () => {
    const value = row();
    const trained = model();
    const before = predictRecommendationBehavioralV6Sequence(trained, value);
    const beforeCandidateEmbeddings = trained.candidateEmbeddings.slice();
    const loss = trainRecommendationBehavioralV6SequenceDecision(
      trained,
      value,
      { learningRate: 0.05, l2: 0, gradientClip: 1 },
    );
    const after = predictRecommendationBehavioralV6Sequence(trained, value);

    expect(Number.isFinite(loss)).toBe(true);
    expect(trained.trainedDecisionCount).toBe(1);
    expect(trained.candidateEmbeddings).not.toEqual(beforeCandidateEmbeddings);
    expect(after.observedActionProbability).not.toBe(before.observedActionProbability);
    expect(after.candidates.reduce((sum, candidate) => sum + candidate.probability, 0)).toBeCloseTo(1, 12);
  });
});

function model() {
  return createRecommendationBehavioralV6SequenceModel({
    historyLength: 16,
    hiddenDimension: 12,
    sequenceEmbeddingHashDimension: 4_096,
    contextEmbeddingHashDimension: 2_048,
    candidateEmbeddingHashDimension: 4_096,
    candidateBiasHashDimension: 8_192,
    recurrenceDecay: 0.8,
  });
}

function rowWithCandidateCount(candidateCount: number): RecommendationProDecisionDatasetV6Row {
  const value = row();
  const template = value.candidates[0];
  value.candidates = Array.from({ length: candidateCount }, (_, index) => {
    const itemId = 2000 + index;
    return {
      ...template,
      actionKey: `BUY:${itemId}`,
      itemId,
      rank: index + 1,
      generatorScore: 1 / (index + 1),
      historicalCount: candidateCount - index,
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
    decisionId: 'decision-sequence-1',
    matchId: 'match-sequence-1',
    matchStartTime: '2026-07-01T00:00:00.000Z',
    playerId: 'player-1',
    split: 'TRAIN',
    state: {
      heroId: 1,
      team: 0,
      phase: 'MID',
      gameTimeS: 1_200,
      inventoryStateKey: '1001x1|1002x1',
      inventoryItemCounts: [
        { itemId: 1001, count: 1 },
        { itemId: 1002, count: 1 },
      ],
      previousActionKeys: ['BUY:1001', 'BUY:1002', 'BUY:1004'],
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
      inventoryTagCounts: { DAMAGE: 1, VITALITY: 1 },
      timelineJoined: true,
      timelineSnapshotLagS: 5,
      kills: 3,
      deaths: 2,
      assists: 7,
      netWorth: 10_500,
      heroDamage: 6_000,
      health: 1_100,
      maxHealth: 1_500,
      level: 12,
    },
    candidates: [candidate(1010, 1, 0.55, 'WEAPON'), candidate(1011, 2, 0.45, 'VITALITY')],
    observedActionKey: 'BUY:1010',
    observedActionInCandidateSet: true,
    shortHorizonOutcomes: {},
    finalOutcome: 1,
    versions: {
      catalog: 'TEST',
      catalogSha256: 'a'.repeat(64),
      candidateGenerator: 'TEST',
      candidateGeneratorPolicy: 'TEST',
      candidateGeneratorPolicySha256: 'b'.repeat(64),
      stateFeatures: 'RECOMMENDATION_STATE_FEATURES_V6_2_FUTURE_TIMELINE_FALLBACK',
      replay: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2',
    },
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
    cost: 3_000,
    tier: 3,
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
    currentNetWorth: 10_500,
    costToNetWorthRatio: 3_000 / 10_500,
  };
}
