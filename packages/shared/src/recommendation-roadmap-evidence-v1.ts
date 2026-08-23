import { RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1 } from './recommendation-direct-shop-validation-v1';
import { RECOMMENDATION_FUTURE_TEST_EVALUATOR_V1 } from './recommendation-future-test-evaluation-v1';
import { RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1 } from './recommendation-sequential-rl-evidence-v1';
import {
  RecommendationRoadmapEvidenceV1,
  RecommendationRoadmapGateStateV1,
} from './recommendation-roadmap-state-v1';

export const RECOMMENDATION_ROADMAP_EVIDENCE_VERSION = 'recommendation-roadmap-evidence-v1' as const;

export type RecommendationRoadmapEvidenceGateNameV1 = keyof RecommendationRoadmapEvidenceV1;

export interface RecommendationRoadmapEvidenceRecordV1 {
  contractVersion: typeof RECOMMENDATION_ROADMAP_EVIDENCE_VERSION;
  evidenceId: string;
  gateName: RecommendationRoadmapEvidenceGateNameV1;
  status: RecommendationRoadmapGateStateV1;
  evidenceRef: string;
  evaluator: string;
  evaluatedAt: string;
  subjectSha256?: string;
  notes?: string;
}

export interface RecommendationRoadmapEvidenceRecordValidationV1 {
  valid: boolean;
  errors: readonly string[];
}

const GATE_NAMES = new Set<RecommendationRoadmapEvidenceGateNameV1>([
  'canonicalGepV2',
  'controlledSoulsValidation',
  'directShopSourceValidation',
  'versionedRulesetCatalog',
  'deterministicLegality',
  'recommendationTelemetryV8',
  'observabilityCoverage',
  'datasetV8Structural',
  'datasetV8Empirical',
  'behavioralOffline',
  'shadowSafety',
  'matchLevelAbSafety',
  'exactActionPropensity',
  'safeExplorationSafety',
  'valueActionSensitivity',
  'offPolicySupport',
  'causalValueRelease',
  'policyAbRelease',
  'futureTestEvaluation',
  'sequentialRlResearchGate',
  'futureTestUntouched',
]);

export function validateRecommendationRoadmapEvidenceRecordV1(
  record: RecommendationRoadmapEvidenceRecordV1,
): RecommendationRoadmapEvidenceRecordValidationV1 {
  const errors: string[] = [];
  if (record.contractVersion !== RECOMMENDATION_ROADMAP_EVIDENCE_VERSION) errors.push('ROADMAP_EVIDENCE_CONTRACT_MISMATCH');
  if (!record.evidenceId) errors.push('EVIDENCE_ID_REQUIRED');
  if (!GATE_NAMES.has(record.gateName)) errors.push('GATE_NAME_INVALID');
  if (record.status === 'NOT_EVALUATED') errors.push('NOT_EVALUATED_CANNOT_BE_PERSISTED');
  if (!record.evidenceRef) errors.push('EVIDENCE_REF_REQUIRED');
  if (!record.evaluator) errors.push('EVALUATOR_REQUIRED');
  if (!isIsoDate(record.evaluatedAt)) errors.push('EVALUATED_AT_INVALID');
  if (record.subjectSha256 !== undefined && !isSha256(record.subjectSha256)) errors.push('SUBJECT_SHA256_INVALID');
  if (record.gateName === 'futureTestUntouched' && record.status === 'INSUFFICIENT_EVIDENCE') {
    errors.push('FUTURE_TEST_UNTOUCHED_REQUIRES_PASS_OR_FAIL');
  }
  if (record.gateName === 'directShopSourceValidation') {
    if (!record.subjectSha256) errors.push('DIRECT_SHOP_VALIDATION_SUBJECT_SHA256_REQUIRED');
    if (record.evaluator !== RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1) {
      errors.push('DIRECT_SHOP_VALIDATION_REQUIRES_STRUCTURED_EVALUATOR');
    }
  }
  if (record.gateName === 'futureTestEvaluation') {
    if (record.status === 'INSUFFICIENT_EVIDENCE') errors.push('FUTURE_TEST_EVALUATION_REQUIRES_PASS_OR_FAIL');
    if (!record.subjectSha256) errors.push('FUTURE_TEST_EVALUATION_SUBJECT_SHA256_REQUIRED');
    if (record.evaluator !== RECOMMENDATION_FUTURE_TEST_EVALUATOR_V1) {
      errors.push('FUTURE_TEST_EVALUATION_REQUIRES_FROZEN_ARTIFACT_EVALUATOR');
    }
  }
  if (record.gateName === 'sequentialRlResearchGate') {
    if (!record.subjectSha256) errors.push('SEQUENTIAL_RL_SUBJECT_SHA256_REQUIRED');
    if (record.evaluator !== RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1) {
      errors.push('SEQUENTIAL_RL_REQUIRES_CANONICAL_EVALUATOR');
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

export function assertRecommendationRoadmapEvidenceRecordV1(record: RecommendationRoadmapEvidenceRecordV1): void {
  const validation = validateRecommendationRoadmapEvidenceRecordV1(record);
  if (!validation.valid) throw new Error(`Roadmap evidence is invalid: ${validation.errors.join(',')}`);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isIsoDate(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
