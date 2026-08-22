export const RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1 = 'recommendation-direct-shop-source-validation-v1' as const;
export const RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1 = 'recommendation-direct-shop-source-validation-evaluator-v1' as const;

export interface RecommendationDirectShopCandidateAnalysisCandidateV1 {
  provenanceSourceField: string;
  markerHitCount: number;
  availableMarkerHitCount: number;
  unavailableMarkerHitCount: number;
  lowCardinality: boolean;
  observedPayloadsSeparatedByMarkerState: boolean;
}

export interface RecommendationDirectShopCandidateAnalysisV1 {
  version: string;
  candidateOnly: true;
  canPromoteToDirectSource: false;
  markerCount: number;
  availableMarkerCount: number;
  unavailableMarkerCount: number;
  blockers: readonly string[];
  candidates: readonly RecommendationDirectShopCandidateAnalysisCandidateV1[];
}

export interface RecommendationDirectShopSourceValidationAttestationV1 {
  contractVersion: typeof RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1;
  telemetrySource: string;
  provenanceSourceField: string;
  candidateAnalysisSha256: string;
  candidateAnalysis: RecommendationDirectShopCandidateAnalysisV1;
  independentlyValidatedAvailableTransitions: number;
  independentlyValidatedUnavailableTransitions: number;
  independentTransitionMismatchCount: number;
  validator: string;
  validatedAt: string;
  evidenceRef: string;
}

export interface RecommendationDirectShopSourceValidationReportV1 {
  contractVersion: typeof RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1;
  generatedAt: string;
  status: 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE';
  approvalKey: string;
  canActivateDirectShopSource: boolean;
  blockers: readonly string[];
  attestation: RecommendationDirectShopSourceValidationAttestationV1;
}

export function directShopValidationApprovalKeyV1(
  telemetrySource: string,
  provenanceSourceField: string,
): string {
  return `${telemetrySource.trim()}:${provenanceSourceField.trim()}`;
}

export function evaluateRecommendationDirectShopSourceValidationV1(
  attestation: RecommendationDirectShopSourceValidationAttestationV1,
  generatedAt = new Date().toISOString(),
): RecommendationDirectShopSourceValidationReportV1 {
  const invalid: string[] = [];
  const insufficient: string[] = [];

  if (attestation.contractVersion !== RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1) invalid.push('DIRECT_SHOP_VALIDATION_CONTRACT_MISMATCH');
  if (!attestation.telemetrySource?.trim()) invalid.push('TELEMETRY_SOURCE_REQUIRED');
  if (!attestation.provenanceSourceField?.trim()) invalid.push('PROVENANCE_SOURCE_FIELD_REQUIRED');
  if (!isSha256(attestation.candidateAnalysisSha256)) invalid.push('CANDIDATE_ANALYSIS_SHA256_INVALID');
  nonNegativeInteger('INDEPENDENT_AVAILABLE_TRANSITIONS', attestation.independentlyValidatedAvailableTransitions, invalid);
  nonNegativeInteger('INDEPENDENT_UNAVAILABLE_TRANSITIONS', attestation.independentlyValidatedUnavailableTransitions, invalid);
  nonNegativeInteger('INDEPENDENT_TRANSITION_MISMATCH_COUNT', attestation.independentTransitionMismatchCount, invalid);
  if (!attestation.validator?.trim()) invalid.push('VALIDATOR_REQUIRED');
  if (!isIsoDate(attestation.validatedAt)) invalid.push('VALIDATED_AT_INVALID');
  if (!attestation.evidenceRef?.trim()) invalid.push('EVIDENCE_REF_REQUIRED');

  const analysis = attestation.candidateAnalysis;
  if (!analysis || typeof analysis !== 'object') {
    invalid.push('CANDIDATE_ANALYSIS_REQUIRED');
  } else {
    if (!analysis.version?.trim()) invalid.push('CANDIDATE_ANALYSIS_VERSION_REQUIRED');
    if (analysis.candidateOnly !== true) invalid.push('CANDIDATE_ANALYSIS_MUST_BE_CANDIDATE_ONLY');
    if (analysis.canPromoteToDirectSource !== false) invalid.push('CANDIDATE_ANALYSIS_SELF_PROMOTION_FORBIDDEN');
    nonNegativeInteger('MARKER_COUNT', analysis.markerCount, invalid);
    nonNegativeInteger('AVAILABLE_MARKER_COUNT', analysis.availableMarkerCount, invalid);
    nonNegativeInteger('UNAVAILABLE_MARKER_COUNT', analysis.unavailableMarkerCount, invalid);
    if (!Array.isArray(analysis.blockers)) invalid.push('CANDIDATE_ANALYSIS_BLOCKERS_REQUIRED');
    if (!Array.isArray(analysis.candidates)) invalid.push('CANDIDATE_ANALYSIS_CANDIDATES_REQUIRED');
  }

  const candidates = Array.isArray(analysis?.candidates)
    ? analysis.candidates.filter((candidate) => candidate?.provenanceSourceField === attestation.provenanceSourceField)
    : [];
  if (candidates.length !== 1) invalid.push(`DIRECT_SHOP_CANDIDATE_MATCH_COUNT_INVALID:${candidates.length}`);
  const candidate = candidates[0];
  if (candidate) {
    nonNegativeInteger('CANDIDATE_MARKER_HIT_COUNT', candidate.markerHitCount, invalid);
    nonNegativeInteger('CANDIDATE_AVAILABLE_MARKER_HIT_COUNT', candidate.availableMarkerHitCount, invalid);
    nonNegativeInteger('CANDIDATE_UNAVAILABLE_MARKER_HIT_COUNT', candidate.unavailableMarkerHitCount, invalid);
    if (candidate.markerHitCount > analysis.markerCount) invalid.push('CANDIDATE_MARKER_HITS_EXCEED_MARKERS');
    if (candidate.availableMarkerHitCount > analysis.availableMarkerCount) invalid.push('CANDIDATE_AVAILABLE_HITS_EXCEED_MARKERS');
    if (candidate.unavailableMarkerHitCount > analysis.unavailableMarkerCount) invalid.push('CANDIDATE_UNAVAILABLE_HITS_EXCEED_MARKERS');
    if (candidate.availableMarkerHitCount + candidate.unavailableMarkerHitCount !== candidate.markerHitCount) {
      invalid.push('CANDIDATE_MARKER_HIT_COUNT_MISMATCH');
    }
  }

  if (invalid.length === 0 && analysis && candidate) {
    if (analysis.markerCount < 6) insufficient.push('SHOP_MARKER_COUNT_BELOW_6');
    if (analysis.availableMarkerCount === 0) insufficient.push('SHOP_AVAILABLE_MARKERS_MISSING');
    if (analysis.unavailableMarkerCount === 0) insufficient.push('SHOP_UNAVAILABLE_MARKERS_MISSING');
    if (analysis.blockers.length > 0) {
      insufficient.push(...analysis.blockers.map((blocker) => `CANDIDATE_ANALYSIS:${blocker}`));
    }
    if (candidate.availableMarkerHitCount === 0) insufficient.push('CANDIDATE_AVAILABLE_MARKER_HITS_MISSING');
    if (candidate.unavailableMarkerHitCount === 0) insufficient.push('CANDIDATE_UNAVAILABLE_MARKER_HITS_MISSING');
    if (!candidate.lowCardinality) insufficient.push('CANDIDATE_NOT_LOW_CARDINALITY');
    if (!candidate.observedPayloadsSeparatedByMarkerState) insufficient.push('CANDIDATE_MARKER_PAYLOADS_NOT_SEPARATED');
    if (attestation.independentlyValidatedAvailableTransitions === 0) insufficient.push('INDEPENDENT_AVAILABLE_TRANSITION_MISSING');
    if (attestation.independentlyValidatedUnavailableTransitions === 0) insufficient.push('INDEPENDENT_UNAVAILABLE_TRANSITION_MISSING');
  }

  const blockers = [...new Set([...invalid, ...insufficient])].sort();
  const mismatchFailure = attestation.independentTransitionMismatchCount > 0;
  const status: RecommendationDirectShopSourceValidationReportV1['status'] = invalid.length > 0 || mismatchFailure
    ? 'FAIL'
    : insufficient.length > 0
      ? 'INSUFFICIENT_EVIDENCE'
      : 'PASS';
  const finalBlockers = mismatchFailure
    ? [...new Set([...blockers, 'INDEPENDENT_TRANSITION_MISMATCH_OBSERVED'])].sort()
    : blockers;

  return {
    contractVersion: RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1,
    generatedAt: normalizeIso(generatedAt),
    status,
    approvalKey: directShopValidationApprovalKeyV1(attestation.telemetrySource, attestation.provenanceSourceField),
    canActivateDirectShopSource: status === 'PASS',
    blockers: finalBlockers,
    attestation,
  };
}

function nonNegativeInteger(name: string, value: number, errors: string[]): void {
  if (!Number.isInteger(value) || value < 0) errors.push(`${name}_INVALID`);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isIsoDate(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function normalizeIso(value: string): string {
  if (!isIsoDate(value)) throw new Error('generatedAt is invalid');
  return new Date(value).toISOString();
}
