const assert = require('node:assert/strict');
const {
  SOULS_AFFORDABILITY_EVIDENCE_V2,
  evaluateBehavioralTrainingReadinessV1,
  evaluatePolicyAbGateV1,
  evaluateSoulsAffordabilityEvidenceV2,
  evaluateValuePolicyReleaseGateV1,
} = require('../dist');

const blockedTraining = evaluateBehavioralTrainingReadinessV1({
  observabilityGatePassed: false,
  datasetStructuralPassed: true,
  datasetEmpiricalPassed: false,
  soulsAffordabilityVerdict: 'INSUFFICIENT_EVIDENCE',
  candidateCoverage: 0.8,
  rulesetCatalogCoverage: 1,
  transactionMechanicsCoverage: 0,
  futureTestEvaluated: false,
  observedActionInjectionDetected: false,
});
assert.equal(blockedTraining.ready, false);
assert(blockedTraining.blockers.includes('OBSERVABILITY_GATE_NOT_PASS'));
assert(blockedTraining.blockers.includes('SOULS_AFFORDABILITY_INSUFFICIENT_EVIDENCE'));

const policyPass = evaluatePolicyAbGateV1({
  matchCount: 2_000,
  decisionCount: 200_000,
  assignmentAtMatchLevelRate: 1,
  exactLoggedPropensityRate: 1,
  illegalRecommendationRate: 0,
  exposureAckCoverage: 0.995,
  telemetrySchemaErrorRate: 0,
  primaryOutcomeDelta: 0.02,
  primaryOutcomeCiLow: 0.001,
  primaryOutcomeCiHigh: 0.04,
  crashRateDelta: 0,
  abandonmentRateDelta: 0,
});
assert.equal(policyPass.passed, true);

const valueBlocked = evaluateValuePolicyReleaseGateV1({
  valueActionSensitivityPassed: false,
  offPolicySupportPassed: true,
  doublyRobustEstimate: 0.01,
  doublyRobustCiLow: 0.001,
  doublyRobustCiHigh: 0.02,
  effectiveSampleSize: 10_000,
  actionResidualVariance: 0,
  illegalCandidateRate: 0,
});
assert.equal(valueBlocked.passed, false);
assert(valueBlocked.blockers.includes('VALUE_ACTION_SENSITIVITY_NOT_PASS'));
assert(valueBlocked.blockers.includes('ACTION_RESIDUAL_COLLAPSE'));

const controlled = Array.from({ length: 100 }, (_, index) => ({
  evidenceVersion: SOULS_AFFORDABILITY_EVIDENCE_V2,
  observationId: `obs-${index}`,
  sessionId: `session-${Math.floor(index / 20)}`,
  actionType: index % 3 === 0 ? 'SELL' : index % 2 === 0 ? 'UPGRADE' : 'BUY',
  itemId: 1,
  clientVersion: 'client-1',
  gepVersion: 'gep-1',
  normalizerVersion: 'gep-canonical-v2',
  rulesetVersion: 'ruleset-1',
  catalogSha256: 'a'.repeat(64),
  sourceOccurredAtMs: 1_000 + index,
  capturedAtMs: 1_010 + index,
  shopOpportunityObserved: 'AVAILABLE',
  soulsRawBefore: 2_000,
  soulsRawAfter: 1_200,
  effectiveCost: 800,
  actionSucceeded: true,
  hudSoulsBefore: 2_000,
  hudSoulsAfter: 1_200,
  inventoryConfirmedBefore: true,
  inventoryConfirmedAfter: true,
}));
const controlledReport = evaluateSoulsAffordabilityEvidenceV2(controlled);
assert.equal(controlledReport.invalidObservationIds.length, 0);
assert.equal(controlledReport.affordability.verdict, 'INSUFFICIENT_EVIDENCE');
assert.equal(controlledReport.canMarkSpendableSoulsVerified, false);

console.log('recommendation release gates v1 fixtures: PASS');
