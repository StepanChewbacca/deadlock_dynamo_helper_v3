const assert = require('node:assert/strict');
const {
  RECOMMENDATION_FUTURE_TEST_EVALUATION_V1,
  validateRecommendationFutureTestEvaluationArtifactV1,
} = require('../dist');

const valid = {
  contractVersion: RECOMMENDATION_FUTURE_TEST_EVALUATION_V1,
  policyModelId: 'deadlock-policy-v1',
  policyModelVersion: 'policy-2026-08-22',
  policyManifestSha256: 'a'.repeat(64),
  evaluationPlanSha256: 'b'.repeat(64),
  evaluationArtifactSha256: 'c'.repeat(64),
  evaluationArtifactRef: 's3://deadlock-immutable/future-test/eval-1.json',
  evaluatedAt: '2026-08-22T00:00:00.000Z',
  gateStatus: 'PASS',
  modelSelectionFrozen: true,
  hyperparametersFrozen: true,
  candidateGeneratorFrozen: true,
  featureContractFrozen: true,
  futureTestAccessCount: 1,
};

assert.equal(validateRecommendationFutureTestEvaluationArtifactV1(valid).valid, true);

const invalid = validateRecommendationFutureTestEvaluationArtifactV1({
  ...valid,
  hyperparametersFrozen: false,
  futureTestAccessCount: 2,
});
assert.equal(invalid.valid, false);
assert(invalid.errors.includes('HYPERPARAMETERS_MUST_BE_FROZEN'));
assert(invalid.errors.includes('FUTURE_TEST_MUST_BE_ACCESSED_EXACTLY_ONCE'));

console.log('recommendation future test evaluation v1 fixtures: PASS');
