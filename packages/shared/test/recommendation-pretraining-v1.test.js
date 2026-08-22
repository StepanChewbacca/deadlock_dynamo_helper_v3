const assert = require('node:assert/strict');
const {
  RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1,
  RECOMMENDATION_DATASET_MANIFEST_VERSION,
  RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  evaluateRecommendationBehavioralTrainingLaunchV1,
  validateRecommendationDatasetManifestV1,
} = require('../dist');

function manifest(shadowDecisions = 10000) {
  return {
    contractVersion: RECOMMENDATION_DATASET_MANIFEST_VERSION,
    datasetId: 'dataset-v8-pretraining',
    datasetSha256: 'a'.repeat(64),
    createdAt: '2026-08-22T00:00:00.000Z',
    sourceCommitSha: 'b'.repeat(40),
    datasetContractVersion: 'recommendation-dataset-v8',
    featureContractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
    actionContractVersion: 'recommendation-actions-v1',
    candidateGeneratorVersion: 'candidate-v1',
    pointInTimeCorrect: true,
    observedActionInjected: false,
    futureTestTouched: false,
    supportedRulesetVersions: ['ruleset-1'],
    supportedCatalogSha256: ['c'.repeat(64)],
    splits: [
      {
        split: 'TRAIN',
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-10T00:00:00.000Z',
        matchCount: 100,
        decisionCount: 20000,
        matchSetSha256: '1'.repeat(64),
        sealed: false,
      },
      {
        split: 'VALIDATION',
        from: '2026-07-10T00:00:00.000Z',
        to: '2026-07-15T00:00:00.000Z',
        matchCount: 50,
        decisionCount: 5000,
        matchSetSha256: '2'.repeat(64),
        sealed: false,
      },
      {
        split: 'SHADOW_HOLDOUT',
        from: '2026-07-15T00:00:00.000Z',
        to: '2026-07-20T00:00:00.000Z',
        matchCount: 80,
        decisionCount: shadowDecisions,
        matchSetSha256: '3'.repeat(64),
        sealed: false,
      },
      {
        split: 'FUTURE_TEST',
        from: '2026-07-20T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
        matchCount: 0,
        decisionCount: 0,
        matchSetSha256: '4'.repeat(64),
        sealed: true,
      },
    ],
    files: [
      { path: 'splits/train.jsonl.gz', sha256: '5'.repeat(64), sizeBytes: 1000, rowCount: 20000 },
      { path: 'splits/validation.jsonl.gz', sha256: '6'.repeat(64), sizeBytes: 500, rowCount: 5000 },
      { path: 'splits/shadow_holdout.jsonl.gz', sha256: '7'.repeat(64), sizeBytes: 800, rowCount: shadowDecisions },
    ],
  };
}

function config() {
  return {
    contractVersion: RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1,
    family: 'SEQUENCE_TRANSFORMER',
    seed: 17,
    deterministic: true,
    trainSplit: 'TRAIN',
    validationSplit: 'VALIDATION',
    selectionSplit: 'SHADOW_HOLDOUT',
    futureTestAllowed: false,
    device: 'cuda',
    maxEpochs: 30,
    batchSize: 64,
    evaluationBatchSize: 128,
    learningRate: 0.0003,
    minimumLearningRate: 0.000001,
    weightDecay: 0.0001,
    gradientClip: 1,
    maximumHistoryEvents: 64,
    hashDimension: 65536,
    embeddingDimension: 128,
    hiddenDimension: 256,
    layerCount: 3,
    attentionHeads: 8,
    dropout: 0.1,
    earlyStoppingPatience: 4,
    earlyStoppingMinDelta: 0.000001,
    lrPlateauPatience: 1,
    lrPlateauFactor: 0.5,
    shuffleBufferDecisions: 8192,
    supportProbabilityThreshold: 0.0001,
    majorCohortMinDecisions: 50,
    majorCohortMinFraction: 0.005,
    gateMinDecisions: 10000,
    gateMinCandidateCoverage: 0.99,
    gateMinSupport: 0.9,
    gateMinMajorCohortSupport: 0.75,
    gateMaxFloorSensitivity: 0.02,
  };
}

function evidence() {
  return {
    canonicalGepV2: 'PASS',
    controlledSoulsValidation: 'PASS',
    versionedRulesetCatalog: 'PASS',
    deterministicLegality: 'PASS',
    recommendationTelemetryV8: 'PASS',
    observabilityCoverage: 'PASS',
    datasetV8Structural: 'PASS',
    datasetV8Empirical: 'PASS',
    behavioralOffline: 'NOT_EVALUATED',
    shadowSafety: 'NOT_EVALUATED',
    matchLevelAbSafety: 'NOT_EVALUATED',
    exactActionPropensity: 'NOT_EVALUATED',
    safeExplorationSafety: 'NOT_EVALUATED',
    valueActionSensitivity: 'NOT_EVALUATED',
    offPolicySupport: 'NOT_EVALUATED',
    causalValueRelease: 'NOT_EVALUATED',
    policyAbRelease: 'NOT_EVALUATED',
    sequentialRlResearchGate: 'NOT_EVALUATED',
    futureTestEvaluation: 'NOT_EVALUATED',
    futureTestUntouched: true,
  };
}

const valid = manifest();
assert.deepEqual(validateRecommendationDatasetManifestV1(valid), { valid: true, errors: [] });

const reordered = { ...valid, splits: [valid.splits[1], valid.splits[0], ...valid.splits.slice(2)] };
assert(validateRecommendationDatasetManifestV1(reordered).errors.includes('DATASET_SPLIT_ORDER_INVALID'));

const rowMismatch = {
  ...valid,
  files: valid.files.map((file) => file.path.includes('validation') ? { ...file, rowCount: file.rowCount - 1 } : file),
};
assert(validateRecommendationDatasetManifestV1(rowMismatch).errors.includes('SPLIT_FILE_ROW_COUNT_MISMATCH:VALIDATION'));

const insufficientHoldout = evaluateRecommendationBehavioralTrainingLaunchV1({
  manifest: manifest(9999),
  evidence: evidence(),
  config: config(),
});
assert.equal(insufficientHoldout.ready, false);
assert(insufficientHoldout.blockers.includes('SHADOW_HOLDOUT_DECISION_COUNT_BELOW_GATE'));

const ready = evaluateRecommendationBehavioralTrainingLaunchV1({
  manifest: manifest(10000),
  evidence: evidence(),
  config: config(),
});
assert.equal(ready.ready, true);
assert.deepEqual(ready.blockers, []);

console.log('recommendation pretraining v1 fixtures: PASS');
