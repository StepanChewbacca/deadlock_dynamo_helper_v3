const assert = require('node:assert/strict');
const {
  EXACT_ACTION_PROPENSITY_SOURCE,
  MODEL_BUNDLE_CONTRACT_VERSION,
  evaluateBehavioralModelGateV1,
  evaluateOffPolicyV1,
  evaluateShadowGateV1,
  evaluateValueActionSensitivityV1,
  validateModelBundleRuntimeCompatibilityV1,
} = require('../dist');

const manifest = {
  contractVersion: MODEL_BUNDLE_CONTRACT_VERSION,
  modelId: 'behavioral-buildlm',
  modelVersion: 'v1',
  modelKind: 'BEHAVIORAL',
  createdAt: '2026-08-21T00:00:00.000Z',
  sourceCommitSha: 'a'.repeat(40),
  datasetId: 'dataset-v8-001',
  datasetSha256: 'b'.repeat(64),
  featureContractVersion: 'features-v8',
  actionContractVersion: 'actions-v1',
  candidateGeneratorVersion: 'candidate-v1',
  supportedRulesetVersions: ['ruleset-1'],
  supportedCatalogSha256: ['c'.repeat(64)],
  trainingConfigSha256: 'd'.repeat(64),
  files: [{ path: 'model/model.onnx', sha256: 'e'.repeat(64), sizeBytes: 123 }],
  gates: [
    { name: 'CANDIDATE_COVERAGE', status: 'PASS', value: 0.995, threshold: 0.99 },
    { name: 'SUPPORT', status: 'PASS', value: 0.91, threshold: 0.90 },
  ],
  futureTestEvaluated: false,
};

assert.deepEqual(
  validateModelBundleRuntimeCompatibilityV1(manifest, {
    featureContractVersion: 'features-v8',
    actionContractVersion: 'actions-v1',
    candidateGeneratorVersion: 'candidate-v1',
    rulesetVersion: 'ruleset-1',
    catalogSha256: 'c'.repeat(64),
    requiredGateNames: ['CANDIDATE_COVERAGE', 'SUPPORT'],
  }),
  { valid: true, errors: [] },
);

const incompatible = validateModelBundleRuntimeCompatibilityV1(manifest, {
  featureContractVersion: 'features-v7',
  actionContractVersion: 'actions-v1',
  candidateGeneratorVersion: 'candidate-v1',
  rulesetVersion: 'ruleset-1',
  catalogSha256: 'c'.repeat(64),
  requiredGateNames: ['CANDIDATE_COVERAGE'],
});
assert.equal(incompatible.valid, false);
assert(incompatible.errors.includes('FEATURE_CONTRACT_INCOMPATIBLE'));

const behavioral = evaluateBehavioralModelGateV1({
  decisionCount: 100000,
  candidateCoverage: 0.995,
  support: 0.91,
  majorCohortSupportMin: 0.80,
  rawLogLoss: 1.0,
  baselineRawLogLoss: 1.2,
  floorSensitivity: 0.01,
  probabilityFloorApplied: false,
  illegalCandidateRate: 0,
});
assert.equal(behavioral.passed, true);

const badBehavioral = evaluateBehavioralModelGateV1({
  decisionCount: 100000,
  candidateCoverage: 0.995,
  support: 0.91,
  majorCohortSupportMin: 0.80,
  rawLogLoss: 1.0,
  baselineRawLogLoss: 1.2,
  floorSensitivity: 0.30,
  probabilityFloorApplied: true,
  illegalCandidateRate: 0,
});
assert.equal(badBehavioral.passed, false);

const shadow = evaluateShadowGateV1({
  matchCount: 1000,
  decisionCount: 100000,
  illegalRecommendationRate: 0,
  staleStateRate: 0.005,
  fallbackRate: 0.01,
  p99LatencyMs: 100,
  crashCount: 0,
  schemaErrorRate: 0,
});
assert.equal(shadow.passed, true);

const opeRows = Array.from({ length: 200 }, (_, index) => ({
  decisionId: `d-${index}`,
  reward: 1,
  loggingPropensity: 0.5,
  loggingPropensitySource: EXACT_ACTION_PROPENSITY_SOURCE,
  targetProbability: 0.5,
  qLogged: 0.8,
  qTargetExpected: 0.8,
}));
const ope = evaluateOffPolicyV1(opeRows);
assert.equal(ope.ips, 1);
assert.equal(ope.snips, 1);
assert(Math.abs(ope.doublyRobust - 1) < 1e-12);
assert.equal(ope.passedSupportGate, true);

assert.throws(
  () => evaluateOffPolicyV1([{ ...opeRows[0], loggingPropensity: 0 }]),
  /Invalid logging propensity/,
);
assert.throws(
  () => evaluateOffPolicyV1([{ ...opeRows[0], loggingPropensitySource: 'RECONSTRUCTED' }]),
  /Reconstructed logging propensity is forbidden/,
);

const sensitivity = evaluateValueActionSensitivityV1({
  originalPredictions: [0.1, 0.4, 0.8],
  actionMaskedPredictions: [0.1, 0.1, 0.1],
  candidatePermutedPredictions: [0.8, 0.1, 0.4],
});
assert.equal(sensitivity.passed, true);

const collapsed = evaluateValueActionSensitivityV1({
  originalPredictions: [0.5, 0.5, 0.5],
  actionMaskedPredictions: [0.5, 0.5, 0.5],
  candidatePermutedPredictions: [0.5, 0.5, 0.5],
});
assert.equal(collapsed.passed, false);

console.log('model contracts v1 fixtures: PASS');
