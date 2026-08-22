const assert = require('node:assert/strict');
const {
  RECOMMENDATION_DIRECT_SHOP_CANDIDATE_ANALYSIS_VERSION_V1,
  RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1,
  evaluateRecommendationDirectShopSourceValidationV1,
} = require('../dist');

const sourceField = 'onInfoUpdates2|match_info|match_info|shop_state';
const approvalKey = `OVERWOLF_GEP:${sourceField}`;

function candidateAnalysis(overrides = {}) {
  return {
    version: RECOMMENDATION_DIRECT_SHOP_CANDIDATE_ANALYSIS_VERSION_V1,
    candidateOnly: true,
    canPromoteToDirectSource: false,
    markerCount: 8,
    availableMarkerCount: 4,
    unavailableMarkerCount: 4,
    blockers: [],
    candidates: [{
      provenanceSourceField: sourceField,
      markerHitCount: 8,
      availableMarkerHitCount: 4,
      unavailableMarkerHitCount: 4,
      lowCardinality: true,
      observedPayloadsSeparatedByMarkerState: true,
    }],
    ...overrides,
  };
}

function attestation(overrides = {}) {
  return {
    contractVersion: RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1,
    telemetrySource: 'OVERWOLF_GEP',
    provenanceSourceField: sourceField,
    candidateAnalysisSha256: 'a'.repeat(64),
    candidateAnalysis: candidateAnalysis(),
    independentlyValidatedAvailableTransitions: 2,
    independentlyValidatedUnavailableTransitions: 2,
    independentTransitionMismatchCount: 0,
    independentValidationEvidenceSha256: 'b'.repeat(64),
    validator: 'independent-live-transition-review-v1',
    validatedAt: '2026-08-22T09:00:00.000Z',
    evidenceRef: 'immutable://deadlock/direct-shop-validation/evidence-1',
    ...overrides,
  };
}

const pass = evaluateRecommendationDirectShopSourceValidationV1(
  attestation(),
  '2026-08-22T09:05:00.000Z',
);
assert.equal(pass.status, 'PASS');
assert.equal(pass.canActivateDirectShopSource, true);
assert.equal(pass.approvalKey, approvalKey);
assert.deepEqual(pass.blockers, []);

const insufficient = evaluateRecommendationDirectShopSourceValidationV1(attestation({
  independentlyValidatedAvailableTransitions: 0,
  independentlyValidatedUnavailableTransitions: 0,
}));
assert.equal(insufficient.status, 'INSUFFICIENT_EVIDENCE');
assert.equal(insufficient.canActivateDirectShopSource, false);
assert(insufficient.blockers.includes('INDEPENDENT_AVAILABLE_TRANSITION_MISSING'));
assert(insufficient.blockers.includes('INDEPENDENT_UNAVAILABLE_TRANSITION_MISSING'));

const mismatch = evaluateRecommendationDirectShopSourceValidationV1(attestation({
  independentTransitionMismatchCount: 1,
}));
assert.equal(mismatch.status, 'FAIL');
assert.equal(mismatch.canActivateDirectShopSource, false);
assert(mismatch.blockers.includes('INDEPENDENT_TRANSITION_MISMATCH_OBSERVED'));

const candidateOnly = evaluateRecommendationDirectShopSourceValidationV1(attestation({
  candidateAnalysis: candidateAnalysis({
    blockers: ['NO_LOW_CARDINALITY_SEPARATING_CANDIDATE'],
    candidates: [{
      provenanceSourceField: sourceField,
      markerHitCount: 8,
      availableMarkerHitCount: 4,
      unavailableMarkerHitCount: 4,
      lowCardinality: false,
      observedPayloadsSeparatedByMarkerState: false,
    }],
  }),
}));
assert.equal(candidateOnly.status, 'INSUFFICIENT_EVIDENCE');
assert.equal(candidateOnly.canActivateDirectSource, undefined);
assert.equal(candidateOnly.canActivateDirectShopSource, false);

const wrongCandidate = evaluateRecommendationDirectShopSourceValidationV1(attestation({
  candidateAnalysis: candidateAnalysis({
    candidates: [{
      provenanceSourceField: `${sourceField}_other`,
      markerHitCount: 8,
      availableMarkerHitCount: 4,
      unavailableMarkerHitCount: 4,
      lowCardinality: true,
      observedPayloadsSeparatedByMarkerState: true,
    }],
  }),
}));
assert.equal(wrongCandidate.status, 'FAIL');
assert(wrongCandidate.blockers.includes('DIRECT_SHOP_CANDIDATE_MATCH_COUNT_INVALID:0'));

const wrongAnalysisVersion = evaluateRecommendationDirectShopSourceValidationV1(attestation({
  candidateAnalysis: candidateAnalysis({ version: 'shop-signal-candidate-analysis-v2' }),
}));
assert.equal(wrongAnalysisVersion.status, 'FAIL');
assert(wrongAnalysisVersion.blockers.includes('CANDIDATE_ANALYSIS_VERSION_MISMATCH'));

const missingIndependentEvidenceHash = evaluateRecommendationDirectShopSourceValidationV1(attestation({
  independentValidationEvidenceSha256: '',
}));
assert.equal(missingIndependentEvidenceHash.status, 'FAIL');
assert(missingIndependentEvidenceHash.blockers.includes('INDEPENDENT_VALIDATION_EVIDENCE_SHA256_INVALID'));

console.log('recommendation direct shop validation v1 fixtures: PASS');
