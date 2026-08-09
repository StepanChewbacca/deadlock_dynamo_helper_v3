import type { RecommendationBehavioralV5PropensityRow } from '../src/deadlock-live/recommendation-behavioral-v5-training.service';
import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationProDecisionDatasetV6Row,
} from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';
import type { RecommendationValueV8CandidateSetPrediction } from '../src/deadlock-live/recommendation-value-v8-diagnostic';
import {
  buildRecommendationValueV8ReleaseGate,
  createRecommendationValueV8EvaluationAccumulator,
  evaluateRecommendationValueV8Decision,
  finalizeRecommendationValueV8Evaluation,
  observeRecommendationValueV8Evaluation,
  selectRecommendationValueV8Configuration,
  validateRecommendationV6ShortOnlyBaselineManifest,
  type RecommendationV6ShortOnlyBaselineManifest,
  type RecommendationV6ShortOnlyBaselineRow,
} from '../src/deadlock-live/recommendation-value-v8-full-evaluation';

const MODEL_SHA = 'a'.repeat(64);
const DATASET_SHA = 'b'.repeat(64);
const SPLIT_SHA = 'c'.repeat(64);
const ARTIFACT_SHA = 'd'.repeat(64);

describe('Recommendation Value V8 full evaluation', () => {
  it('accepts only the frozen V6 short-only baseline contract', () => {
    const value = baselineManifest();

    expect(() =>
      validateRecommendationV6ShortOnlyBaselineManifest(
        value,
        DATASET_SHA,
        SPLIT_SHA,
      ),
    ).not.toThrow();

    const invalid = structuredClone(value);
    invalid.sourceModel.configuration.finalOutcomeWeight = 0.1 as never;
    expect(() =>
      validateRecommendationV6ShortOnlyBaselineManifest(
        invalid,
        DATASET_SHA,
        SPLIT_SHA,
      ),
    ).toThrow('incompatible');
  });

  it('evaluates V8, frozen V6, OPE, and cohorts on the same decision', () => {
    const metrics = metricsFor(row('FUTURE_TEST'), 1, 1);

    expect(metrics.candidateCoverage).toBe(1);
    expect(metrics.behaviorSupport).toBe(1);
    expect(metrics.v8Rmse).toBeLessThan(metrics.stateRmse);
    expect(metrics.v8Rmse).toBeLessThan(metrics.baselineRmse);
    expect(metrics.averageCandidateSeparation).toBeGreaterThan(0);
    expect(metrics.ope.targetEssRatio).toBe(1);
    expect(metrics.ope.drUpliftLower95).toBeGreaterThan(0);
    expect(metrics.cohorts).toHaveLength(4);
  });

  it('selects configuration using TUNING metrics only', () => {
    const value = row('TUNING');
    const selection = selectRecommendationValueV8Configuration([
      {
        configuration: { actionScale: 0, policyTemperature: 1 },
        metrics: metricsFor(value, 0, 2),
      },
      {
        configuration: { actionScale: 1, policyTemperature: 0.5 },
        metrics: metricsFor(value, 1, 2),
      },
    ]);

    expect(selection.selected.configuration).toEqual({
      actionScale: 1,
      policyTemperature: 0.5,
    });
    expect(selection.selectedOn).toBe('TUNING_ONLY');
    expect(selection.futureTestUsed).toBe(false);
  });

  it('authorizes passive shadow but never randomized canary', () => {
    const gate = buildRecommendationValueV8ReleaseGate(
      metricsFor(row('FUTURE_TEST'), 1, 2),
      true,
      {
        minimumCandidateCoverage: 0.99,
        minimumBehaviorSupport: 0.9,
        minimumEssRatio: 0.5,
        maximumClippedWeightRate: 0.05,
        minimumStateRmseImprovement: 0,
        minimumBaselineRmseImprovement: 0,
        minimumCandidateSeparation: 0.001,
        minimumDrUpliftLower95: 0,
        maximumCriticallyNegativeMajorCohorts: 0,
      },
    );

    expect(gate.passed).toBe(true);
    expect(gate.passiveShadowAuthorized).toBe(true);
    expect(gate.randomizedCanaryAuthorized).toBe(false);
  });
});

function metricsFor(
  value: RecommendationProDecisionDatasetV6Row,
  actionScale: number,
  cohortMinimumDecisions: number,
) {
  const evaluation = evaluateRecommendationValueV8Decision({
    row: value,
    propensity: propensity(value),
    baseline: baseline(value),
    statePredictions: { '3m': 0.1, '5m': 0.1, '10m': 0.1 },
    candidatePrediction: candidatePrediction(),
    options: {
      configuration: { actionScale, policyTemperature: 0.5 },
      maximumImportanceWeight: 20,
      cohortMinimumDecisions,
      criticalCohortRmseTolerance: 0,
    },
    sourceModelSha256: MODEL_SHA,
    sourceDatasetSha256: DATASET_SHA,
    splitDescriptorSha256: SPLIT_SHA,
  });
  const accumulator = createRecommendationValueV8EvaluationAccumulator(
    value.split as 'TUNING' | 'FUTURE_TEST',
  );
  observeRecommendationValueV8Evaluation(accumulator, evaluation);
  return finalizeRecommendationValueV8Evaluation(accumulator, {
    cohortMinimumDecisions,
    criticalCohortRmseTolerance: 0,
  });
}

function baselineManifest(): RecommendationV6ShortOnlyBaselineManifest {
  return {
    schemaVersion: 1,
    baselineVersion: 'RECOMMENDATION_V6_SHORT_ONLY_DATASET_V6_BASELINE_1',
    productionCommit: '251660f',
    generatedAt: '2026-07-28T00:00:00.000Z',
    sourceModel: {
      modelVersion: 'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1',
      sha256: MODEL_SHA,
      configuration: {
        shortOnly: true,
        finalOutcomeWeight: 0,
        statePriorStrength: 10,
        actionPriorStrength: 0.1,
        minimumObservations: 10,
      },
    },
    sourceDataset: {
      datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
      sha256: DATASET_SHA,
      splitDescriptorSha256: SPLIT_SHA,
    },
    artifact: {
      format: 'NDJSON',
      fileName: 'predictions.ndjson',
      sha256: ARTIFACT_SHA,
      byteLength: 100,
      rowCount: 2,
    },
    auditPassed: true,
    frozen: true,
  };
}

function propensity(
  value: RecommendationProDecisionDatasetV6Row,
): RecommendationBehavioralV5PropensityRow {
  return {
    schemaVersion: 2,
    modelVersion:
      'RECOMMENDATION_BEHAVIORAL_V5_1_HASHED_CONDITIONAL_CHOICE_2_RAW_PROPENSITY',
    featureVersion:
      'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_4_CAPACITY_INTERACTIONS',
    decisionId: value.decisionId,
    matchId: value.matchId,
    split: value.split,
    predictionSource: 'FULL_TRAIN_MODEL',
    trainingMatchExcluded: true,
    observedActionKey: value.observedActionKey,
    observedActionRawProbability: 0.5,
    observedActionProbability: 0.5,
    probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
    supported: true,
    propensityFloor: 0.01,
    propensityFloorApplied: false,
    candidates: [
      candidatePropensity('BUY:100', 100, 1),
      candidatePropensity('BUY:200', 200, 2),
    ],
    modelArtifactSha256: 'e'.repeat(64),
    sourceDatasetSha256: DATASET_SHA,
  };
}

function candidatePropensity(actionKey: string, itemId: number, rank: number) {
  return {
    actionKey,
    itemId,
    score: 0,
    rawProbability: 0.5,
    probability: 0.5,
    rank,
  };
}

function baseline(
  value: RecommendationProDecisionDatasetV6Row,
): RecommendationV6ShortOnlyBaselineRow {
  return {
    schemaVersion: 1,
    baselineVersion: 'RECOMMENDATION_V6_SHORT_ONLY_DATASET_V6_BASELINE_1',
    productionCommit: '251660f',
    decisionId: value.decisionId,
    matchId: value.matchId,
    split: value.split as 'TUNING' | 'FUTURE_TEST',
    observedActionKey: value.observedActionKey,
    targetUtility: 0.5,
    stateUtility: -0.1,
    observedActionUtility: -0.1,
    observedActionAdvantage: 0,
    candidateRanking: [
      {
        actionKey: 'BUY:200',
        rank: 1,
        actionUtility: 0,
        actionAdvantage: 0.1,
      },
      {
        actionKey: 'BUY:100',
        rank: 2,
        actionUtility: -0.1,
        actionAdvantage: 0,
      },
    ],
    sourceModelSha256: MODEL_SHA,
    sourceDatasetSha256: DATASET_SHA,
    splitDescriptorSha256: SPLIT_SHA,
  };
}

function candidatePrediction(): RecommendationValueV8CandidateSetPrediction {
  return {
    candidates: [
      predictedCandidate('BUY:100', 100, 0.3, 1),
      predictedCandidate('BUY:200', 200, -0.3, 2),
    ],
    meanRawResiduals: { '3m': 0, '5m': 0, '10m': 0 },
    candidateSeparation: 0.6,
    maximumAbsoluteCenteredMean: 0,
  };
}

function predictedCandidate(
  actionKey: string,
  itemId: number,
  advantage: number,
  rank: number,
) {
  return {
    actionKey,
    itemId,
    rawResiduals: {
      '3m': advantage,
      '5m': advantage,
      '10m': advantage,
    },
    advantages: {
      '3m': advantage,
      '5m': advantage,
      '10m': advantage,
    },
    aggregateAdvantage: advantage,
    rank,
  };
}

function row(
  split: 'TUNING' | 'FUTURE_TEST',
): RecommendationProDecisionDatasetV6Row {
  return {
    schemaVersion: 1,
    datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
    dataSource: 'PRO_HISTORICAL',
    decisionSource: 'HISTORICAL_REPLAY',
    decisionId: `decision-${split}`,
    matchId: `match-${split}`,
    matchStartTime: '2026-07-01T00:00:00.000Z',
    playerId: '1',
    split,
    state: {
      heroId: 1,
      team: 0,
      phase: 'EARLY',
      gameTimeS: 600,
      inventoryStateKey: '50x1',
      inventoryItemCounts: [{ itemId: 50, count: 1 }],
      previousActionKeys: ['BUY:50'],
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
      inventoryTagCounts: { WEAPON: 1 },
      timelineJoined: true,
      timelineSnapshotLagS: 1,
      kills: 2,
      deaths: 1,
      assists: 3,
      netWorth: 8_000,
      heroDamage: 4_000,
      health: 900,
      maxHealth: 1_000,
      level: 8,
    },
    candidates: [
      candidate('BUY:100', 100, 3, 3_000),
      candidate('BUY:200', 200, 1, 500),
    ],
    observedActionKey: 'BUY:100',
    observedActionInCandidateSet: true,
    shortHorizonOutcomes: {
      threeMinutes: 0.5,
      fiveMinutes: 0.5,
      tenMinutes: 0.5,
    },
    finalOutcome: 1,
    versions: {
      catalog: 'catalog-1',
      catalogSha256: 'f'.repeat(64),
      candidateGenerator: 'generator-1',
      candidateGeneratorPolicy: 'policy-1',
      candidateGeneratorPolicySha256: '1'.repeat(64),
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
  tier: number,
  cost: number,
): RecommendationDatasetV6CandidateFeatures {
  return {
    actionKey,
    actionType: 'BUY',
    itemId,
    rank: itemId === 100 ? 1 : 2,
    generatorScore: itemId === 100 ? 0.6 : 0.4,
    historicalCount: 100,
    historicalProbability: 0.5,
    confidence: 0.8,
    predictedStateKey: `50x1|${itemId}x1`,
    catalogMetadataAvailable: true,
    cost,
    tier,
    slotType: 'WEAPON',
    itemType: 'UPGRADE',
    isActiveItem: false,
    activationType: 'PASSIVE',
    tags: itemId === 100 ? ['DAMAGE'] : ['UTILITY'],
    componentItemIds: [50, 51],
    requiredComponentCount: 2,
    ownedComponentCount: itemId === 100 ? 2 : 0,
    missingComponentCount: itemId === 100 ? 0 : 2,
    hasAnyOwnedComponent: itemId === 100,
    hasCompleteRecipeComponents: itemId === 100,
    alreadyOwnedCount: 0,
    sameSlotOwnedItemCount: 1,
    inventoryTagOverlapCount: 1,
    previousActionCount: 0,
    currentNetWorth: 8_000,
    costToNetWorthRatio: cost / 8_000,
  };
}
