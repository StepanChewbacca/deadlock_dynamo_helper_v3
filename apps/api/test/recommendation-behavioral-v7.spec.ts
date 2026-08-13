import {
  createRecommendationBehavioralV7Model,
  predictRecommendationBehavioralV7,
  recommendationBehavioralV7FeatureTokens,
  trainRecommendationBehavioralV7Decision,
} from '../src/deadlock-live/recommendation-behavioral-v7';
import type { RecommendationProDecisionDatasetV7Row } from '../src/deadlock-live/recommendation-pro-decision-dataset-v7';

function row(): RecommendationProDecisionDatasetV7Row {
  return {
    schemaVersion: 1,
    datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1',
    observabilityVersion: 'RECOMMENDATION_OBSERVABILITY_V7_STRICT_PREDECISION_1',
    sourceDatasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
    sourceDecisionId: 'd1',
    dataSource: 'PRO_HISTORICAL',
    decisionSource: 'HISTORICAL_REPLAY',
    decisionId: 'd1',
    matchId: 'm1',
    matchStartTime: '2026-01-01T00:00:00.000Z',
    playerId: 'p1',
    split: 'TRAIN',
    state: {
      heroId: 1,
      team: 0,
      phase: 'MID',
      gameTimeS: 600,
      inventoryStateKey: '',
      inventoryItemCounts: [],
      previousActionKeys: ['BUY:100'],
      alliedHeroIds: [],
      enemyHeroIds: [],
      inventoryTagCounts: {},
      timelineJoined: true,
      netWorth: 10000,
    },
    observability: [
      {
        fieldName: 'shopAvailable',
        family: 'SHOP_OPPORTUNITY',
        value: true,
        missing: false,
        sourceSystem: 'TELEMETRY_V7',
        sourceEntity: 'decision',
        sourceField: 'shopAvailable',
        sourceGameTimeS: 599,
        alignmentAgeS: 1,
        directlyObserved: true,
        reconstructed: false,
        provenanceVersion: 'OBS_V7_1',
      },
    ],
    candidates: [
      candidate('BUY:101', 101, 1, true),
      candidate('BUY:102', 102, 2, true),
    ],
    choiceSet: {
      coverageUniverseActionKeys: ['BUY:101', 'BUY:102'],
      behavioralChoiceSetActionKeys: ['BUY:101', 'BUY:102'],
      behavioralChoiceSetDefinition: 'V7_OBSERVED_AVAILABILITY_TOP96_1',
      observedActionInjected: false,
      selectedAfterObservedAction: false,
      feasibilityAware: true,
    },
    observedActionKey: 'BUY:101',
    observedActionInCandidateSet: true,
    shortHorizonOutcomes: {},
    finalOutcome: 1,
    versions: {
      catalog: 'c1',
      catalogSha256: 'a'.repeat(64),
      candidateGenerator: 'g1',
      candidateGeneratorPolicy: 'p1',
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

function candidate(
  actionKey: string,
  itemId: number,
  rank: number,
  feasible: boolean,
) {
  return {
    actionKey,
    actionType: 'BUY' as const,
    itemId,
    rank,
    generatorScore: 1 / rank,
    historicalCount: 1,
    historicalProbability: 0.5,
    confidence: 1,
    predictedStateKey: actionKey,
    catalogMetadataAvailable: true,
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
    feasibility: {
      evaluated: true,
      feasible,
      reasonCodes: [feasible ? ('SHOP_AVAILABLE' as const) : ('SHOP_UNAVAILABLE' as const)],
      sourceFields: ['shopAvailable'],
      observedOnly: true,
    },
  };
}

describe('Recommendation Behavioral V7', () => {
  it('normalizes raw probabilities', () => {
    const model = createRecommendationBehavioralV7Model({ hashDimension: 1024 });
    const prediction = predictRecommendationBehavioralV7(model, row());
    expect(
      prediction.candidates.reduce((sum, candidate) => sum + candidate.probability, 0),
    ).toBeCloseTo(1, 12);
  });

  it('uses observability and availability tokens without observed-action tokens', () => {
    const tokens = recommendationBehavioralV7FeatureTokens(row(), 'BUY:101');
    expect(tokens.some((token) => token.includes('shopAvailable'))).toBe(true);
    expect(tokens.some((token) => token.includes('SHOP_AVAILABLE'))).toBe(true);
    expect(tokens.some((token) => token.includes('OBSERVED'))).toBe(false);
  });

  it('trains with aggregated hashed updates', () => {
    const model = createRecommendationBehavioralV7Model({ hashDimension: 1024 });
    const before = predictRecommendationBehavioralV7(model, row()).observedActionProbability;
    const result = trainRecommendationBehavioralV7Decision(model, row(), {
      learningRate: 0.05,
      l2: 0.0001,
      gradientClip: 1,
    });
    const after = predictRecommendationBehavioralV7(model, row()).observedActionProbability;
    expect(result.optimizerAudit.uniqueParameterUpdates).toBeLessThanOrEqual(
      result.optimizerAudit.rawFeatureTouches,
    );
    expect(after).toBeGreaterThan(before);
  });
});
