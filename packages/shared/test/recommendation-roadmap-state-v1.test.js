const assert = require('node:assert/strict');
const { evaluateRecommendationRoadmapStateV1 } = require('../dist');

const allPassBeforeFutureTest = {
  canonicalGepV2: 'PASS',
  controlledSoulsValidation: 'PASS',
  directShopSourceValidation: 'PASS',
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
  futureTestEvaluation: 'NOT_EVALUATED',
  futureTestUntouched: true,
};

const beforeFutureTest = evaluateRecommendationRoadmapStateV1(allPassBeforeFutureTest);
assert.equal(beforeFutureTest.highestUnlockedPhase, 'POLICY_V1');
assert.equal(beforeFutureTest.phases.find((phase) => phase.phase === 'SEQUENTIAL_RL_RESEARCH').unlocked, false);
assert(beforeFutureTest.phases.find((phase) => phase.phase === 'SEQUENTIAL_RL_RESEARCH').blockers.includes('futureTestEvaluation:NOT_EVALUATED'));

const complete = evaluateRecommendationRoadmapStateV1({
  ...allPassBeforeFutureTest,
  futureTestEvaluation: 'PASS',
});
assert.equal(complete.highestUnlockedPhase, 'SEQUENTIAL_RL_RESEARCH');
assert(complete.phases.every((phase) => phase.unlocked));

const blocked = evaluateRecommendationRoadmapStateV1({
  ...allPassBeforeFutureTest,
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

const directShopBlocked = evaluateRecommendationRoadmapStateV1({
  ...allPassBeforeFutureTest,
  directShopSourceValidation: 'INSUFFICIENT_EVIDENCE',
});
assert.equal(directShopBlocked.highestUnlockedPhase, undefined);
assert(directShopBlocked.phases.find((phase) => phase.phase === 'DATA_CONTRACT').blockers.includes('directShopSourceValidation:INSUFFICIENT_EVIDENCE'));

const futureIntegrityViolation = evaluateRecommendationRoadmapStateV1({
  ...allPassBeforeFutureTest,
  futureTestEvaluation: 'PASS',
  futureTestUntouched: false,
});
assert.equal(futureIntegrityViolation.phases.find((phase) => phase.phase === 'DATA_CONTRACT').unlocked, false);
assert(futureIntegrityViolation.hardBlockers.includes('FUTURE_TEST_INTEGRITY_VIOLATION'));

console.log('recommendation roadmap state v1 fixtures: PASS');
