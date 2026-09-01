import { RecommendationSequentialDatasetReportV1 } from './recommendation-sequential-rl-v1';

export const RECOMMENDATION_SEQUENTIAL_RL_EVIDENCE_V1 = 'recommendation-sequential-rl-evidence-v1' as const;
export const RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1 = 'recommendation-sequential-rl-evaluator-v1' as const;

export interface RecommendationSequentialRlEvidenceAttestationV1 {
  contractVersion: typeof RECOMMENDATION_SEQUENTIAL_RL_EVIDENCE_V1;
  evaluator: typeof RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1;
  policyModelId: string;
  policyModelVersion: string;
  policyManifestSha256: string;
  transitionArtifactSha256: string;
  transitionArtifactRef: string;
  transitionReportSha256: string;
  evaluatedAt: string;
  researchOnly: true;
  futureTestUsedForModelSelection: false;
  report: RecommendationSequentialDatasetReportV1;
}

export interface RecommendationSequentialRlEvidenceReportV1 {
  contractVersion: typeof RECOMMENDATION_SEQUENTIAL_RL_EVIDENCE_V1;
  generatedAt: string;
  status: 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE';
  policyManifestSha256: string;
  transitionArtifactSha256: string;
  transitionArtifactRef: string;
  transitionReportSha256: string;
  report: RecommendationSequentialDatasetReportV1;
  blockers: readonly string[];
}

export function evaluateRecommendationSequentialRlEvidenceV1(
  attestation: RecommendationSequentialRlEvidenceAttestationV1,
  generatedAt = new Date().toISOString(),
): RecommendationSequentialRlEvidenceReportV1 {
  const blockers = validateRecommendationSequentialRlEvidenceAttestationV1(attestation);
  if (blockers.length > 0) {
    throw new Error(`Sequential RL evidence attestation is invalid: ${blockers.join(',')}`);
  }
  const reportBlockers = sequentialReportBlockers(attestation.report);
  const status = attestation.report.transitionCount === 0
    ? 'INSUFFICIENT_EVIDENCE'
    : reportBlockers.length === 0
      ? 'PASS'
      : 'FAIL';
  return {
    contractVersion: RECOMMENDATION_SEQUENTIAL_RL_EVIDENCE_V1,
    generatedAt,
    status,
    policyManifestSha256: attestation.policyManifestSha256.toLowerCase(),
    transitionArtifactSha256: attestation.transitionArtifactSha256.toLowerCase(),
    transitionArtifactRef: attestation.transitionArtifactRef,
    transitionReportSha256: attestation.transitionReportSha256.toLowerCase(),
    report: attestation.report,
    blockers: reportBlockers,
  };
}

export function validateRecommendationSequentialRlEvidenceAttestationV1(
  attestation: RecommendationSequentialRlEvidenceAttestationV1,
): readonly string[] {
  const errors: string[] = [];
  if (attestation.contractVersion !== RECOMMENDATION_SEQUENTIAL_RL_EVIDENCE_V1) errors.push('SEQUENTIAL_RL_EVIDENCE_CONTRACT_MISMATCH');
  if (attestation.evaluator !== RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1) errors.push('SEQUENTIAL_RL_EVALUATOR_MISMATCH');
  if (!attestation.policyModelId) errors.push('POLICY_MODEL_ID_REQUIRED');
  if (!attestation.policyModelVersion) errors.push('POLICY_MODEL_VERSION_REQUIRED');
  if (!isSha256(attestation.policyManifestSha256)) errors.push('POLICY_MANIFEST_SHA256_INVALID');
  if (!isSha256(attestation.transitionArtifactSha256)) errors.push('TRANSITION_ARTIFACT_SHA256_INVALID');
  if (!isSha256(attestation.transitionReportSha256)) errors.push('TRANSITION_REPORT_SHA256_INVALID');
  if (!attestation.transitionArtifactRef) errors.push('TRANSITION_ARTIFACT_REF_REQUIRED');
  if (!isIsoDate(attestation.evaluatedAt)) errors.push('EVALUATED_AT_INVALID');
  if (attestation.researchOnly !== true) errors.push('SEQUENTIAL_RL_MUST_BE_RESEARCH_ONLY');
  if (attestation.futureTestUsedForModelSelection !== false) errors.push('FUTURE_TEST_MODEL_SELECTION_FORBIDDEN');
  errors.push(...validateSequentialReport(attestation.report));
  return [...new Set(errors)].sort();
}

function validateSequentialReport(report: RecommendationSequentialDatasetReportV1): string[] {
  const errors: string[] = [];
  for (const [name, value] of [
    ['transitionCount', report?.transitionCount],
    ['matchCount', report?.matchCount],
    ['terminalTransitionCount', report?.terminalTransitionCount],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) errors.push(`${name.toUpperCase()}_INVALID`);
  }
  if (report && report.matchCount > report.transitionCount) errors.push('MATCH_COUNT_EXCEEDS_TRANSITION_COUNT');
  if (report && report.terminalTransitionCount > report.transitionCount) errors.push('TERMINAL_COUNT_EXCEEDS_TRANSITION_COUNT');
  for (const [name, value] of [
    ['invalidTransitionIds', report?.invalidTransitionIds],
    ['futureLeakageTransitionIds', report?.futureLeakageTransitionIds],
    ['rulesetMismatchTransitionIds', report?.rulesetMismatchTransitionIds],
    ['reconstructedPropensityTransitionIds', report?.reconstructedPropensityTransitionIds],
  ] as const) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry)) {
      errors.push(`${name.toUpperCase()}_INVALID`);
    }
  }
  const expectedCanRun = Boolean(
    report
    && report.transitionCount > 0
    && report.invalidTransitionIds.length === 0
    && report.futureLeakageTransitionIds.length === 0
    && report.rulesetMismatchTransitionIds.length === 0
    && report.reconstructedPropensityTransitionIds.length === 0
  );
  if (report?.canRunSequentialRlResearch !== expectedCanRun) errors.push('SEQUENTIAL_RL_REPORT_CAN_RUN_MISMATCH');
  return errors;
}

function sequentialReportBlockers(report: RecommendationSequentialDatasetReportV1): string[] {
  const blockers: string[] = [];
  if (report.transitionCount === 0) blockers.push('SEQUENTIAL_TRANSITIONS_MISSING');
  if (report.invalidTransitionIds.length > 0) blockers.push('INVALID_SEQUENTIAL_TRANSITIONS_PRESENT');
  if (report.futureLeakageTransitionIds.length > 0) blockers.push('SEQUENTIAL_FUTURE_LEAKAGE_PRESENT');
  if (report.rulesetMismatchTransitionIds.length > 0) blockers.push('SEQUENTIAL_RULESET_MISMATCH_PRESENT');
  if (report.reconstructedPropensityTransitionIds.length > 0) blockers.push('RECONSTRUCTED_PROPENSITY_PRESENT');
  if (report.transitionCount > 0 && report.matchCount === 0) blockers.push('SEQUENTIAL_MATCH_SET_EMPTY');
  if (report.transitionCount > 0 && report.terminalTransitionCount === 0) blockers.push('SEQUENTIAL_TERMINAL_TRANSITIONS_MISSING');
  return [...new Set(blockers)].sort();
}

function isSha256(value: string): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isIsoDate(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
