const assert = require('node:assert/strict');
const {
  RECOMMENDATION_POLICY_ARTIFACT_V1,
  validateRecommendationPolicyArtifactV1,
} = require('../dist');

const valid = {
  contractVersion: RECOMMENDATION_POLICY_ARTIFACT_V1,
  policyConfig: {
    temperature: 1,
    behaviorRegularization: 0.1,
    minimumBehaviorSupport: 0.01,
  },
  behavioral: {
    modelId: 'behavioral-v8',
    modelVersion: 'b1',
    modelKind: 'BEHAVIORAL',
    manifestSha256: 'a'.repeat(64),
  },
  value: {
    modelId: 'value-v8',
    modelVersion: 'v1',
    modelKind: 'VALUE',
    manifestSha256: 'b'.repeat(64),
  },
  featureContractVersion: 'recommendation-features-v8',
  actionContractVersion: 'recommendation-actions-v1',
  candidateGeneratorVersion: 'candidate-v1',
  supportedRulesetVersions: ['ruleset-v1'],
  supportedCatalogSha256: ['c'.repeat(64)],
  futureTestEvaluated: false,
};

assert.equal(validateRecommendationPolicyArtifactV1(valid).valid, true);

const unsupported = validateRecommendationPolicyArtifactV1({
  ...valid,
  policyConfig: { ...valid.policyConfig, minimumBehaviorSupport: 0 },
});
assert.equal(unsupported.valid, false);
assert(unsupported.errors.includes('POLICY_MINIMUM_BEHAVIOR_SUPPORT_REQUIRED'));

console.log('recommendation policy artifact v1 fixtures: PASS');
