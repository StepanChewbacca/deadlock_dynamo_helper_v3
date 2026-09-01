const assert = require('node:assert/strict');
const {
  EXACT_ACTION_PROPENSITY_SOURCE,
  SOULS_AFFORDABILITY_EVIDENCE_V2,
  evaluateBehavioralTrainingReadinessV1,
  evaluateOffPolicyV1,
  evaluatePolicyAbGateV1,
  evaluateRecommendationValueTrainingReadinessV1,
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

const opeRows = Array.from({ length: 200 }, (_, index) => ({
  decisionId: `ope-${index}`,
  reward: index % 2,
  loggingPropensity: 0.5,
  loggingPropensitySource: EXACT_ACTION_PROPENSITY_SOURCE,
  targetProbability: 0.5,
  qLogged: index % 2,
  qTargetExpected: (index % 2) + 0.1,
}));
const ope = evaluateOffPolicyV1(opeRows);
assert.equal(ope.passedSupportGate, true);
assert.equal(ope.effectiveSampleSizeRatio, 1);
assert.equal(ope.clippedDecisionRate, 0);
assert(Math.abs(ope.doublyRobustUplift - 0.1) < 1e-12);
assert(ope.doublyRobustUpliftCiLow > 0);
assert(ope.doublyRobustUpliftCiHigh > 0);

const valueTrainingReady = evaluateRecommendationValueTrainingReadinessV1({
  safeExplorationPhaseUnlocked: true,
  exactActionPropensityPassed: true,
  safeExplorationSafetyPassed: true,
  opeEvidenceSufficient: true,
  opeSupportPassed: ope.passedSupportGate,
  randomizedDecisionCount: 200,
  evaluableDecisionCount: 200,
  excludedDecisionCount: 0,
  effectiveSampleSize: ope.effectiveSampleSize,
  effectiveSampleSizeRatio: ope.effectiveSampleSizeRatio,
  clippedDecisionRate: ope.clippedDecisionRate,
  futureTestUntouched: true,
  futureTestEvaluated: false,
});
assert.equal(valueTrainingReady.ready, true);

const valueTrainingBlocked = evaluateRecommendationValueTrainingReadinessV1({
  safeExplorationPhaseUnlocked: false,
  exactActionPropensityPassed: false,
  safeExplorationSafetyPassed: false,
  opeEvidenceSufficient: false,
  opeSupportPassed: false,
  randomizedDecisionCount: 0,
  evaluableDecisionCount: 0,
  excludedDecisionCount: 0,
  effectiveSampleSize: 0,
  effectiveSampleSizeRatio: 0,
  clippedDecisionRate: 0,
  futureTestUntouched: true,
  futureTestEvaluated: false,
});
assert.equal(valueTrainingBlocked.ready, false);
assert(valueTrainingBlocked.blockers.includes('SAFE_EXPLORATION_PHASE_NOT_UNLOCKED'));
assert(valueTrainingBlocked.blockers.includes('NO_RANDOMIZED_DECISIONS'));
assert(valueTrainingBlocked.blockers.includes('OPE_EVIDENCE_INSUFFICIENT'));

const lowEssRows = Array.from({ length: 200 }, (_, index) => ({
  decisionId: `low-ess-${index}`,
  reward: 1,
  loggingPropensity: index === 0 ? 0.001 : 1,
  loggingPropensitySource: EXACT_ACTION_PROPENSITY_SOURCE,
  targetProbability: 1,
  qLogged: 1,
  qTargetExpected: 1.1,
}));
const lowEss = evaluateOffPolicyV1(lowEssRows, { minEffectiveSampleSize: 1 });
assert.equal(lowEss.passedSupportGate, false);
assert(lowEss.effectiveSampleSizeRatio < 0.5);

const clipped = evaluateOffPolicyV1(lowEssRows, {
  maxImportanceWeight: 2,
  minEffectiveSampleSize: 1,
  minEffectiveSampleSizeRatio: 0,
  maxClippedDecisionRate: 0,
});
assert.equal(clipped.clippedDecisionCount, 1);
assert.equal(clipped.clippedDecisionRate, 1 / 200);
assert.equal(clipped.passedSupportGate, false);

const controlled = Array.from({ length: 100 }, (_, index) => ({
  evidenceVersion: SOULS_AFFORDABILITY_EVIDENCE_V2,
  observationId: `obs-${index}`,
  sessionId: `session-${Math.floor(index / 20)}`,
  matchId: `match-${Math.floor(index / 10)}`,
  gameTimeSec: 120 + index,
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
