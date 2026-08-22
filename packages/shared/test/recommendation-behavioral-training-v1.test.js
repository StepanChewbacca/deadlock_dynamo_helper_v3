const assert = require('node:assert/strict');
const {
  RECOMMENDATION_BEHAVIORAL_TRAINING_EXAMPLE_V1,
  RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1,
  RECOMMENDATION_DATASET_MANIFEST_VERSION,
  RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  evaluateRecommendationBehavioralTrainingLaunchV1,
  validateRecommendationBehavioralTrainingExampleV1,
} = require('../dist');

const state = {
  contractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  decisionId: 'd1',
  matchId: 'm1',
  playerKey: 'p1',
  decisionAtMs: 2000,
  stateSourceAtMs: 1900,
  gameTimeSec: 120,
  heroId: 1,
  verifiedSpendableSouls: 1600,
  spendableSoulsVerificationContract: 'souls-affordability-v2:PASS',
  shopOpportunity: 'AVAILABLE',
  inventorySnapshotSha256: 'a'.repeat(64),
  inventory: [],
  history: [],
  rulesetVersion: 'r1',
  catalogSha256: 'b'.repeat(64),
};

const example = {
  contractVersion: RECOMMENDATION_BEHAVIORAL_TRAINING_EXAMPLE_V1,
  split: 'TRAIN',
  decisionId: 'd1',
  matchId: 'm1',
  candidateGeneratorVersion: 'candidate-v8',
  state,
  candidates: [
    { actionKey: 'WAIT_SAVE', actionType: 'WAIT_SAVE', effectiveCostSouls: 0, feasible: true },
    { actionKey: 'BUY_ITEM:10', actionType: 'BUY_ITEM', targetItemId: 10, effectiveCostSouls: 800, feasible: true },
  ],
  observedActionKey: 'BUY_ITEM:10',
  observedActionInjected: false,
  actionLoggingPropensity: 1,
  actionLoggingPropensitySource: 'RECORDED_AT_ACTION_SELECTION',
};
assert.deepEqual(validateRecommendationBehavioralTrainingExampleV1(example), []);
assert(validateRecommendationBehavioralTrainingExampleV1({ ...example, observedActionKey: 'BUY_ITEM:999' }).includes('OBSERVED_ACTION_OUTSIDE_FEASIBLE_SET'));
assert(validateRecommendationBehavioralTrainingExampleV1({ ...example, split: 'FUTURE_TEST', observedActionInjected: true }).includes('OBSERVED_ACTION_INJECTION_FORBIDDEN'));

const manifest = {
  contractVersion: RECOMMENDATION_DATASET_MANIFEST_VERSION,
  datasetId: 'dataset-v8-001',
  datasetSha256: 'c'.repeat(64),
  createdAt: '2026-08-21T00:00:00.000Z',
  sourceCommitSha: 'd'.repeat(40),
  datasetContractVersion: 'recommendation-dataset-v8',
  featureContractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  actionContractVersion: 'recommendation-actions-v1',
  candidateGeneratorVersion: 'candidate-v8',
  pointInTimeCorrect: true,
  observedActionInjected: false,
  futureTestTouched: false,
  supportedRulesetVersions: ['r1'],
  supportedCatalogSha256: ['b'.repeat(64)],
  splits: [
    { split: 'TRAIN', from: '2026-07-01T00:00:00.000Z', to: '2026-07-10T00:00:00.000Z', matchCount: 8000, decisionCount: 80000, matchSetSha256: '1'.repeat(64), sealed: false },
    { split: 'VALIDATION', from: '2026-07-10T00:00:00.000Z', to: '2026-07-15T00:00:00.000Z', matchCount: 1000, decisionCount: 10000, matchSetSha256: '2'.repeat(64), sealed: false },
    { split: 'SHADOW_HOLDOUT', from: '2026-07-15T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z', matchCount: 1000, decisionCount: 10000, matchSetSha256: '3'.repeat(64), sealed: false },
    { split: 'FUTURE_TEST', from: '2026-07-20T00:00:00.000Z', to: '2026-07-25T00:00:00.000Z', matchCount: 0, decisionCount: 0, matchSetSha256: '4'.repeat(64), sealed: true },
  ],
  files: [
    { path: 'splits/train.jsonl.gz', sha256: '5'.repeat(64), sizeBytes: 1000, rowCount: 80000 },
    { path: 'splits/validation.jsonl.gz', sha256: '6'.repeat(64), sizeBytes: 1000, rowCount: 10000 },
    { path: 'splits/shadow_holdout.jsonl.gz', sha256: '7'.repeat(64), sizeBytes: 1000, rowCount: 10000 },
  ],
};

const evidence = {
  canonicalGepV2: 'PASS',
  controlledSoulsValidation: 'PASS',
  directShopSourceValidation: 'PASS',
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

const config = {
  contractVersion: RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1,
  family: 'SEQUENCE_TRANSFORMER',
  seed: 17,
  deterministic: true,
  trainSplit: 'TRAIN',
  validationSplit: 'VALIDATION',
  selectionSplit: 'SHADOW_HOLDOUT',
  futureTestAllowed: false,
  maxEpochs: 20,
  batchSize: 256,
  learningRate: 0.0005,
  weightDecay: 0.0001,
  gradientClip: 1,
  maximumHistoryEvents: 64,
  embeddingDimension: 128,
  hiddenDimension: 256,
  layerCount: 3,
  attentionHeads: 8,
  earlyStoppingPatience: 3,
};

const ready = evaluateRecommendationBehavioralTrainingLaunchV1({ manifest, evidence, config });
assert.equal(ready.ready, true);

const futureTouched = evaluateRecommendationBehavioralTrainingLaunchV1({
  manifest: { ...manifest, futureTestTouched: true },
  evidence,
  config,
});
assert.equal(futureTouched.ready, false);
assert(futureTouched.blockers.includes('DATASET_FUTURE_TEST_ALREADY_TOUCHED'));

const dataNotReady = evaluateRecommendationBehavioralTrainingLaunchV1({
  manifest,
  evidence: { ...evidence, datasetV8Empirical: 'INSUFFICIENT_EVIDENCE' },
  config,
});
assert.equal(dataNotReady.ready, false);
assert(dataNotReady.blockers.some((blocker) => blocker.includes('datasetV8Empirical:INSUFFICIENT_EVIDENCE')));

const directShopNotReady = evaluateRecommendationBehavioralTrainingLaunchV1({
  manifest,
  evidence: { ...evidence, directShopSourceValidation: 'INSUFFICIENT_EVIDENCE' },
  config,
});
assert.equal(directShopNotReady.ready, false);
assert(directShopNotReady.blockers.some((blocker) => blocker.includes('directShopSourceValidation:INSUFFICIENT_EVIDENCE')));

console.log('recommendation behavioral training v1 fixtures: PASS');
