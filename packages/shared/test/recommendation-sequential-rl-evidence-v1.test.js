const assert = require('node:assert/strict');
const {
  RECOMMENDATION_SEQUENTIAL_RL_EVIDENCE_V1,
  RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1,
  evaluateRecommendationSequentialRlEvidenceV1,
  validateRecommendationSequentialRlEvidenceAttestationV1,
} = require('../dist');

function report(overrides = {}) {
  return {
    transitionCount: 100,
    matchCount: 10,
    terminalTransitionCount: 10,
    invalidTransitionIds: [],
    futureLeakageTransitionIds: [],
    rulesetMismatchTransitionIds: [],
    reconstructedPropensityTransitionIds: [],
    canRunSequentialRlResearch: true,
    ...overrides,
  };
}

function attestation(overrides = {}) {
  return {
    contractVersion: RECOMMENDATION_SEQUENTIAL_RL_EVIDENCE_V1,
    evaluator: RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1,
    policyModelId: 'policy-v1',
    policyModelVersion: 'frozen-1',
    policyManifestSha256: 'a'.repeat(64),
    transitionArtifactSha256: 'b'.repeat(64),
    transitionArtifactRef: 'immutable://sequential/transitions-1.jsonl',
    transitionReportSha256: 'c'.repeat(64),
    evaluatedAt: '2026-08-23T00:00:00.000Z',
    researchOnly: true,
    futureTestUsedForModelSelection: false,
    report: report(),
    ...overrides,
  };
}

assert.deepEqual(validateRecommendationSequentialRlEvidenceAttestationV1(attestation()), []);
const pass = evaluateRecommendationSequentialRlEvidenceV1(attestation());
assert.equal(pass.status, 'PASS');
assert.deepEqual(pass.blockers, []);

const empty = evaluateRecommendationSequentialRlEvidenceV1(attestation({
  report: report({
    transitionCount: 0,
    matchCount: 0,
    terminalTransitionCount: 0,
    canRunSequentialRlResearch: false,
  }),
}));
assert.equal(empty.status, 'INSUFFICIENT_EVIDENCE');
assert(empty.blockers.includes('SEQUENTIAL_TRANSITIONS_MISSING'));

const failed = evaluateRecommendationSequentialRlEvidenceV1(attestation({
  report: report({
    futureLeakageTransitionIds: ['transition-1'],
    canRunSequentialRlResearch: false,
  }),
}));
assert.equal(failed.status, 'FAIL');
assert(failed.blockers.includes('SEQUENTIAL_FUTURE_LEAKAGE_PRESENT'));

assert.throws(() => evaluateRecommendationSequentialRlEvidenceV1(attestation({
  report: report({ canRunSequentialRlResearch: false }),
})), /SEQUENTIAL_RL_REPORT_CAN_RUN_MISMATCH/);

assert.throws(() => evaluateRecommendationSequentialRlEvidenceV1(attestation({
  futureTestUsedForModelSelection: true,
})), /FUTURE_TEST_MODEL_SELECTION_FORBIDDEN/);

console.log('recommendation sequential RL evidence v1 fixtures: PASS');
