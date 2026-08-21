const assert = require('node:assert/strict');
const {
  RECOMMENDATION_DATASET_MANIFEST_VERSION,
  evaluateRecommendationBehavioralAblationV1,
  validateRecommendationDatasetManifestV1,
} = require('../dist');

const split = (name, from, to, suffix) => ({
  split: name,
  from,
  to,
  matchCount: 100,
  decisionCount: 2500,
  matchSetSha256: suffix.repeat(64),
});

const manifest = {
  contractVersion: RECOMMENDATION_DATASET_MANIFEST_VERSION,
  datasetId: 'dataset-v8-001',
  datasetSha256: 'a'.repeat(64),
  createdAt: '2026-08-21T00:00:00.000Z',
  sourceCommitSha: 'b'.repeat(40),
  datasetContractVersion: 'recommendation-dataset-v8',
  featureContractVersion: 'recommendation-features-v8',
  actionContractVersion: 'recommendation-actions-v1',
  candidateGeneratorVersion: 'feasible-v3',
  pointInTimeCorrect: true,
  observedActionInjected: false,
  futureTestTouched: false,
  supportedRulesetVersions: ['r1'],
  supportedCatalogSha256: ['c'.repeat(64)],
  splits: [
    split('TRAIN', '2026-07-01T00:00:00.000Z', '2026-07-10T00:00:00.000Z', '1'),
    split('VALIDATION', '2026-07-10T00:00:00.000Z', '2026-07-15T00:00:00.000Z', '2'),
    split('SHADOW_HOLDOUT', '2026-07-15T00:00:00.000Z', '2026-07-20T00:00:00.000Z', '3'),
    split('FUTURE_TEST', '2026-07-20T00:00:00.000Z', '2026-07-25T00:00:00.000Z', '4'),
  ],
  files: [{ path: 'dataset/train.parquet', sha256: 'd'.repeat(64), sizeBytes: 100, rowCount: 2500 }],
};
assert.deepEqual(validateRecommendationDatasetManifestV1(manifest), { valid: true, errors: [] });

const leaked = structuredClone(manifest);
leaked.futureTestTouched = true;
leaked.observedActionInjected = true;
const leakedValidation = validateRecommendationDatasetManifestV1(leaked);
assert.equal(leakedValidation.valid, false);
assert(leakedValidation.errors.includes('FUTURE_TEST_ALREADY_TOUCHED'));
assert(leakedValidation.errors.includes('OBSERVED_ACTION_INJECTION_FORBIDDEN'));

const overlapping = structuredClone(manifest);
overlapping.splits[1].from = '2026-07-09T00:00:00.000Z';
assert(validateRecommendationDatasetManifestV1(overlapping).errors.some((error) => error.startsWith('SPLIT_CHRONOLOGY_VIOLATION')));

const common = {
  datasetSha256: 'e'.repeat(64),
  featureContractVersion: 'recommendation-features-v8',
  candidateGeneratorVersion: 'feasible-v3',
  decisionCount: 10000,
  support: 0.92,
  probabilityFloorApplied: false,
};
const ablation = evaluateRecommendationBehavioralAblationV1(
  {
    ...common,
    family: 'SEQUENCE_RNN',
    modelVersion: 'rnn-v1',
    rawLogLoss: 1.1,
    majorCohortSupportMin: 0.78,
  },
  {
    ...common,
    family: 'SEQUENCE_TRANSFORMER',
    modelVersion: 'buildlm-v1',
    rawLogLoss: 1.0,
    majorCohortSupportMin: 0.80,
  },
);
assert.equal(ablation.passed, true);
assert(ablation.transformerLogLossImprovement > 0);
assert(ablation.transformerMajorCohortSupportGain > 0);

const unequal = evaluateRecommendationBehavioralAblationV1(
  {
    ...common,
    family: 'SEQUENCE_RNN',
    modelVersion: 'rnn-v1',
    rawLogLoss: 1.1,
    majorCohortSupportMin: 0.78,
  },
  {
    ...common,
    datasetSha256: 'f'.repeat(64),
    family: 'SEQUENCE_TRANSFORMER',
    modelVersion: 'buildlm-v1',
    rawLogLoss: 1.0,
    majorCohortSupportMin: 0.80,
  },
);
assert.equal(unequal.passed, false);
assert(unequal.blockers.includes('EQUAL_OBSERVABLES_CONTRACT_MISMATCH'));

console.log('recommendation artifact/buildlm v1 fixtures: PASS');
