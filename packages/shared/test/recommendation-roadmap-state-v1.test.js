const assert = require('node:assert/strict');
const { evaluateRecommendationRoadmapStateV1 } = require('../dist');

const allPass = {
  canonicalGepV2: 'PASS',
  controlledSoulsValidation: 'PASS',
  versionedRulesetCatalog: 'PASS',
  deterministicLegality: 'PASS',
  recommendationTelemetryV8: 'PASS',
  observabilityCoverage: 'PASS',
  datasetV8Structural: 'PASS',
  datasetV8Empirical: 'PASS',
  behavioralOffline: 'PASS',
  shadowSafety: 'PASS',
  matchLevelAbSafety: 'PASS',
  exactActionPropensity: 'PASS',
  safeExplorationSafety: 'PASS',
  valueActionSensitivity: 'PASS',
  offPolicySupport: 'PASS',
  causalValueRelease: 'PASS',
  policyAbRelease: 'PASS',
  sequentialRlResearchGate: 'PASS',
  futureTestUntouched: true,
};

const complete = evaluateRecommendationRoadmapStateV1(allPass);
assert.equal(complete.highestUnlockedPhase, 'SEQUENTIAL_RL_RESEARCH');
assert(complete.phases.every((phase) => phase.unlocked));

const blocked = evaluateRecommendationRoadmapStateV1({
  ...allPass,
  controlledSoulsValidation: 'INSUFFICIENT_EVIDENCE',
  observabilityCoverage: 'NOT_EVALUATED',
  datasetV8Empirical: 'NOT_EVALUATED',
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
});
assert.equal(blocked.highestUnlockedPhase, undefined);
assert(blocked.phases.find((phase) => phase.phase === 'DATA_CONTRACT').blockers.includes('controlledSoulsValidation:INSUFFICIENT_EVIDENCE'));
assert(blocked.phases.find((phase) => phase.phase === 'BEHAVIORAL_BUILDLM').blockers.includes('PREREQUISITE_PHASE_NOT_UNLOCKED'));

const futureTouched = evaluateRecommendationRoadmapStateV1({ ...allPass, futureTestUntouched: false });
assert.equal(futureTouched.phases.find((phase) => phase.phase === 'DATA_CONTRACT').unlocked, false);
assert(futureTouched.hardBlockers.includes('FUTURE_TEST_ALREADY_TOUCHED'));

console.log('recommendation roadmap state v1 fixtures: PASS');
