import {
  createRecommendationBehavioralV6LatentMixtureModel,
  predictRecommendationBehavioralV6LatentMixture,
  recommendationBehavioralV6LatentMixtureGateTokens,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_EXPERT_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_GATE_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OBJECTIVE,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OPTIMIZER,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_PROBABILITY_CONTRACT,
  trainRecommendationBehavioralV6LatentMixtureDecision,
  validateRecommendationBehavioralV6LatentMixtureModel,
} from '../src/deadlock-live/recommendation-behavioral-v6-latent-mixture';
import type { RecommendationProDecisionDatasetV6Row } from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';

describe('Recommendation Behavioral V6 latent-state mixture core', () => {
  it('uses frozen latent-mixture raw propensity contracts', () => {
    const value = model();
    validateRecommendationBehavioralV6LatentMixtureModel(value);
    expect(value.modelVersion).toBe(RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_MODEL_VERSION);
    expect(value.probabilityContract).toBe(
      RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_PROBABILITY_CONTRACT,
    );
    expect(value.objective).toBe(RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OBJECTIVE);
    expect(value.gateContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_GATE_CONTRACT);
    expect(value.expertContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_EXPERT_CONTRACT);
    expect(value.optimizerContract).toBe(RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OPTIMIZER);
  });

  it('uses only pre-decision state and ordered history in gate tokens', () => {
    const value = row();
    const tokens = recommendationBehavioralV6LatentMixtureGateTokens(model(), value);
    expect(tokens.some((token) => token.includes('HISTORY_POS:'))).toBe(true);
    expect(tokens.some((token) => token.includes('HISTORY_LAST2:'))).toBe(true);
    expect(tokens.some((token) => token.includes('HISTORY_LAST3:'))).toBe(true);
    expect(tokens.some((token) => token.includes(value.observedActionKey))).toBe(false);
  });

  it('is sensitive to ordered build history', () => {
    const first = row();
    const second = row();
    first.state.previousActionKeys = ['BUY:1001', 'BUY:1002', 'BUY:1003'];
    second.state.previousActionKeys = ['BUY:1003', 'BUY:1002', 'BUY:1001'];
    expect(recommendationBehavioralV6LatentMixtureGateTokens(model(), first)).not.toEqual(
      recommendationBehavioralV6LatentMixtureGateTokens(model(), second),
    );
  });

  it.each([2, 50, 96])('returns a normalized raw mixture for %i candidates', (count) => {
    const value = rowWithCandidateCount(count);
    const prediction = predictRecommendationBehavioralV6LatentMixture(model(), value);
    expect(prediction.candidates).toHaveLength(count);
    expect(prediction.gateProbabilities).toHaveLength(4);
    expect(prediction.gateProbabilities.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 12);
    expect(prediction.candidates.reduce((sum, candidate) => sum + candidate.probability, 0)).toBeCloseTo(1, 12);
    expect(prediction.candidates.every((candidate) => candidate.probability > 0)).toBe(true);
  });

  it('updates gate and expert parameters from mixture responsibilities', () => {
    const value = row();
    const trained = model();
    const before = predictRecommendationBehavioralV6LatentMixture(trained, value);
    const gateBefore = trained.gateWeights.slice();
    const biasBefore = trained.expertCandidateBiases.slice();
    const loss = trainRecommendationBehavioralV6LatentMixtureDecision(
      trained,
      value,
      { learningRate: 0.05, l2: 0, gradientClip: 1 },
    );
    const after = predictRecommendationBehavioralV6LatentMixture(trained, value);

    expect(Number.isFinite(loss)).toBe(true);
    expect(trained.trainedDecisionCount).toBe(1);
    expect(trained.gateWeights).not.toEqual(gateBefore);
    expect(trained.expertCandidateBiases).not.toEqual(biasBefore);
    expect(after.candidates.reduce((sum, candidate) => sum + candidate.probability, 0)).toBeCloseTo(1, 12);
    expect(after.observedActionProbability).not.toBe(before.observedActionProbability);
  });
});

function model() {
  return createRecommendationBehavioralV6LatentMixtureModel({
    expertCount: 4,
    historyLength: 8,
    gateHashDimension: 4_096,
    candidateBiasHashDimension: 8_192,
  });
}

function rowWithCandidateCount(candidateCount: number): RecommendationProDecisionDatasetV6Row {
  const value = row();
  const template = value.candidates[0];
  value.candidates = Array.from({ length: candidateCount }, (_, index) => {
    const itemId = 3000 + index;
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
    decisionId: 'decision-latent-1',
    matchId: 'match-latent-1',
    matchStartTime: '2026-07-01T00:00:00.000Z',
    playerId: 'player-1',
    split: 'TRAIN',
    state: {
      heroId: 1,
      team: 0,
      phase: 'LATE',
      gameTimeS: 2_100,
      inventoryStateKey: '1001x1|1002x1|1003x1',
      inventoryItemCounts: [
        { itemId: 1001, count: 1 },
        { itemId: 1002, count: 1 },
        { itemId: 1003, count: 1 },
      ],
      previousActionKeys: ['BUY:1001', 'BUY:1002', 'BUY:1003'],
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
      inventoryTagCounts: { DAMAGE: 2, VITALITY: 1 },
      timelineJoined: true,
      timelineSnapshotLagS: 5,
      kills: 5,
      deaths: 3,
      assists: 10,
      netWorth: 22_000,
      heroDamage: 12_000,
      health: 1_400,
      maxHealth: 1_800,
      level: 18,
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
    cost: 6_200,
    tier: 4,
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
    currentNetWorth: 22_000,
    costToNetWorthRatio: 6_200 / 22_000,
  };
}
