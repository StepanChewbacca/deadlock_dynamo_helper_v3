export const RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1 = 'recommendation-direct-shop-source-validation-v1' as const;
export const RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1 = 'recommendation-direct-shop-source-validation-evaluator-v1' as const;

export interface RecommendationDirectShopSourceValidationAttestationV1 {
  contractVersion: typeof RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1;
  telemetrySource: string;
  provenanceSourceField: string;
  candidateAnalysisSha256: string;
  candidateAnalysisVersion: string;
  candidateAnalysisBlockers: readonly string[];
  markerCount: number;
  availableMarkerCount: number;
  unavailableMarkerCount: number;
  candidateMarkerHitCount: number;
  candidateAvailableMarkerHitCount: number;
  candidateUnavailableMarkerHitCount: number;
  candidateLowCardinality: boolean;
  candidateObservedPayloadsSeparatedByMarkerState: boolean;
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
  if (!attestation.candidateAnalysisVersion?.trim()) invalid.push('CANDIDATE_ANALYSIS_VERSION_REQUIRED');
  if (!Array.isArray(attestation.candidateAnalysisBlockers)) invalid.push('CANDIDATE_ANALYSIS_BLOCKERS_REQUIRED');
  nonNegativeInteger('MARKER_COUNT', attestation.markerCount, invalid);
  nonNegativeInteger('AVAILABLE_MARKER_COUNT', attestation.availableMarkerCount, invalid);
  nonNegativeInteger('UNAVAILABLE_MARKER_COUNT', attestation.unavailableMarkerCount, invalid);
  nonNegativeInteger('CANDIDATE_MARKER_HIT_COUNT', attestation.candidateMarkerHitCount, invalid);
  nonNegativeInteger('CANDIDATE_AVAILABLE_MARKER_HIT_COUNT', attestation.candidateAvailableMarkerHitCount, invalid);
  nonNegativeInteger('CANDIDATE_UNAVAILABLE_MARKER_HIT_COUNT', attestation.candidateUnavailableMarkerHitCount, invalid);
  nonNegativeInteger('INDEPENDENT_AVAILABLE_TRANSITIONS', attestation.independentlyValidatedAvailableTransitions, invalid);
  nonNegativeInteger('INDEPENDENT_UNAVAILABLE_TRANSITIONS', attestation.independentlyValidatedUnavailableTransitions, invalid);
  nonNegativeInteger('INDEPENDENT_TRANSITION_MISMATCH_COUNT', attestation.independentTransitionMismatchCount, invalid);
  if (!attestation.validator?.trim()) invalid.push('VALIDATOR_REQUIRED');
  if (!isIsoDate(attestation.validatedAt)) invalid.push('VALIDATED_AT_INVALID');
  if (!attestation.evidenceRef?.trim()) invalid.push('EVIDENCE_REF_REQUIRED');
  if (attestation.candidateMarkerHitCount > attestation.markerCount) invalid.push('CANDIDATE_MARKER_HITS_EXCEED_MARKERS');
  if (attestation.candidateAvailableMarkerHitCount > attestation.availableMarkerCount) invalid.push('CANDIDATE_AVAILABLE_HITS_EXCEED_MARKERS');
  if (attestation.candidateUnavailableMarkerHitCount > attestation.unavailableMarkerCount) invalid.push('CANDIDATE_UNAVAILABLE_HITS_EXCEED_MARKERS');
  if (
    attestation.candidateAvailableMarkerHitCount + attestation.candidateUnavailableMarkerHitCount
    !== attestation.candidateMarkerHitCount
  ) invalid.push('CANDIDATE_MARKER_HIT_COUNT_MISMATCH');

  if (invalid.length === 0) {
    if (attestation.markerCount < 6) insufficient.push('SHOP_MARKER_COUNT_BELOW_6');
    if (attestation.availableMarkerCount === 0) insufficient.push('SHOP_AVAILABLE_MARKERS_MISSING');
    if (attestation.unavailableMarkerCount === 0) insufficient.push('SHOP_UNAVAILABLE_MARKERS_MISSING');
    if (attestation.candidateAnalysisBlockers.length > 0) {
      insufficient.push(...attestation.candidateAnalysisBlockers.map((blocker) => `CANDIDATE_ANALYSIS:${blocker}`));
    }
    if (attestation.candidateAvailableMarkerHitCount === 0) insufficient.push('CANDIDATE_AVAILABLE_MARKER_HITS_MISSING');
    if (attestation.candidateUnavailableMarkerHitCount === 0) insufficient.push('CANDIDATE_UNAVAILABLE_MARKER_HITS_MISSING');
    if (!attestation.candidateLowCardinality) insufficient.push('CANDIDATE_NOT_LOW_CARDINALITY');
    if (!attestation.candidateObservedPayloadsSeparatedByMarkerState) insufficient.push('CANDIDATE_MARKER_PAYLOADS_NOT_SEPARATED');
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
