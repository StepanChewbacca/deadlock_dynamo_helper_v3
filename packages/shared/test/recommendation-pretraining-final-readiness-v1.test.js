const assert = require('node:assert/strict');
const {
  RECOMMENDATION_PRETRAINING_FINAL_READINESS_V1,
  evaluateRecommendationPretrainingFinalReadinessV1,
} = require('../dist');

const readyInput = {
  canonicalGepFixtureCoverage: 1,
  controlledSoulsValidation: 'PASS',
  directShopSourceValidation: 'PASS',
  rulesetCatalogCoverage: 0.999,
  deterministicIllegalRecommendationCount: 0,
  recommendationTelemetryContractPassed: true,
  observabilityGatePassed: true,
  datasetStructuralPassed: true,
  datasetEmpiricalPassed: true,
  explicitFeasibilityCoverage: 0.995,
  observedActionFeasibleCoverage: 0.99,
  criticalCohortObservedActionFeasibleCoverage: 0.98,
  shadowHoldoutDecisionCount: 10000,
  datasetRegistryVerified: true,
  datasetRegistryVerificationFresh: true,
  splitIsolationPassed: true,
  futureTestUntouched: true,
  futureTestEvaluated: false,
  rnnApiPreflightReady: true,
  transformerApiPreflightReady: true,
  immutableDatasetBytesVerified: true,
  offlineWheelhouseReady: true,
  trainingDeviceReady: true,
};

const ready = evaluateRecommendationPretrainingFinalReadinessV1(readyInput);
assert.equal(ready.contractVersion, RECOMMENDATION_PRETRAINING_FINAL_READINESS_V1);
assert.equal(ready.readyToStartBehavioralTraining, true);
assert.deepEqual(ready.blockers, []);

const blocked = evaluateRecommendationPretrainingFinalReadinessV1({
  ...readyInput,
  controlledSoulsValidation: 'INSUFFICIENT_EVIDENCE',
  directShopSourceValidation: 'INSUFFICIENT_EVIDENCE',
  rulesetCatalogCoverage: 0.9989,
  explicitFeasibilityCoverage: 0.9949,
  criticalCohortObservedActionFeasibleCoverage: 0.979,
  futureTestEvaluated: true,
  trainingDeviceReady: false,
});
assert.equal(blocked.readyToStartBehavioralTraining, false);
assert(blocked.blockers.includes('CONTROLLED_SOULS_INSUFFICIENT_EVIDENCE'));
assert(blocked.blockers.includes('DIRECT_SHOP_SOURCE_INSUFFICIENT_EVIDENCE'));
assert(blocked.blockers.includes('RULESET_CATALOG_COVERAGE_BELOW_0_999'));
assert(blocked.blockers.includes('EXPLICIT_FEASIBILITY_COVERAGE_BELOW_0_995'));
assert(blocked.blockers.includes('CRITICAL_COHORT_OBSERVED_ACTION_FEASIBLE_COVERAGE_BELOW_0_98'));
assert(blocked.blockers.includes('FUTURE_TEST_ALREADY_EVALUATED'));
assert(blocked.blockers.includes('TRAINING_DEVICE_NOT_READY'));

assert.throws(
  () => evaluateRecommendationPretrainingFinalReadinessV1({ ...readyInput, canonicalGepFixtureCoverage: 1.01 }),
  /canonicalGepFixtureCoverage must be in \[0,1\]/,
);

console.log('recommendation final pretraining readiness v1 fixtures: PASS');
