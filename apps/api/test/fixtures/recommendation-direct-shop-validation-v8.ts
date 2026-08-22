import { createHash } from 'crypto';
import {
  RECOMMENDATION_DIRECT_SHOP_CANDIDATE_ANALYSIS_VERSION_V1,
  RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1,
  RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1,
  evaluateRecommendationDirectShopSourceValidationV1,
} from '@deadlock-live-probe/shared';

export const TEST_DIRECT_SHOP_SOURCE_FIELD = 'onInfoUpdates2|match_info|match_info|shop_state';
export const TEST_DIRECT_SHOP_APPROVAL_KEY = `OVERWOLF_GEP:${TEST_DIRECT_SHOP_SOURCE_FIELD}`;

export function createDirectShopCandidateAnalysisV1(
  sourceField = TEST_DIRECT_SHOP_SOURCE_FIELD,
): Record<string, unknown> {
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
  };
}

export function createDirectShopValidationReportV1(
  approvalKey = TEST_DIRECT_SHOP_APPROVAL_KEY,
  generatedAt = '2026-08-22T00:00:00.000Z',
) {
  const separator = approvalKey.indexOf(':');
  if (separator <= 0 || separator === approvalKey.length - 1) throw new Error('approvalKey is invalid');
  const telemetrySource = approvalKey.slice(0, separator);
  const provenanceSourceField = approvalKey.slice(separator + 1);
  const candidateAnalysis = createDirectShopCandidateAnalysisV1(provenanceSourceField);
  const attestation = {
    contractVersion: RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1,
    telemetrySource,
    provenanceSourceField,
    candidateAnalysisSha256: sha256Canonical(candidateAnalysis),
    candidateAnalysis,
    independentlyValidatedAvailableTransitions: 2,
    independentlyValidatedUnavailableTransitions: 2,
    independentTransitionMismatchCount: 0,
    independentValidationEvidenceSha256: '9'.repeat(64),
    validator: 'independent-live-transition-review-v1',
    validatedAt: '2026-08-21T23:55:00.000Z',
    evidenceRef: 'immutable://deadlock/direct-shop-validation/evidence-1',
  };
  return evaluateRecommendationDirectShopSourceValidationV1(attestation as never, generatedAt);
}

export const TEST_DIRECT_SHOP_SUBJECT_SHA256 = directShopValidationSubjectSha256(
  createDirectShopValidationReportV1(),
);

export function createDirectShopValidationSnapshotV8(
  subjectSha256 = TEST_DIRECT_SHOP_SUBJECT_SHA256,
  approvalKey = TEST_DIRECT_SHOP_APPROVAL_KEY,
) {
  const report = createDirectShopValidationReportV1(approvalKey);
  return {
    subjectSha256,
    gateName: 'directShopSourceValidation',
    evaluator: RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1,
    evaluatedAt: new Date(report.generatedAt),
    report,
  };
}

export function directShopValidationSubjectSha256(report: unknown): string {
  return sha256Canonical({ gateName: 'directShopSourceValidation', report });
}

function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
