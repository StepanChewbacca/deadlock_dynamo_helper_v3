export const RECOMMENDATION_FUTURE_TEST_EVALUATION_V1 = 'recommendation-future-test-evaluation-v1' as const;
export const RECOMMENDATION_FUTURE_TEST_EVALUATOR_V1 = 'recommendation-future-test-evaluator-v1' as const;

export type RecommendationFutureTestGateStatusV1 = 'PASS' | 'FAIL';

export interface RecommendationFutureTestEvaluationArtifactV1 {
  contractVersion: typeof RECOMMENDATION_FUTURE_TEST_EVALUATION_V1;
  policyModelId: string;
  policyModelVersion: string;
  policyManifestSha256: string;
  evaluationPlanSha256: string;
  evaluationArtifactSha256: string;
  evaluationArtifactRef: string;
  evaluatedAt: string;
  gateStatus: RecommendationFutureTestGateStatusV1;
  modelSelectionFrozen: true;
  hyperparametersFrozen: true;
  candidateGeneratorFrozen: true;
  featureContractFrozen: true;
  futureTestAccessCount: 1;
}

export interface RecommendationFutureTestEvaluationValidationV1 {
  valid: boolean;
  errors: readonly string[];
}

export function validateRecommendationFutureTestEvaluationArtifactV1(
  artifact: RecommendationFutureTestEvaluationArtifactV1,
): RecommendationFutureTestEvaluationValidationV1 {
  const errors: string[] = [];
  if (artifact.contractVersion !== RECOMMENDATION_FUTURE_TEST_EVALUATION_V1) {
    errors.push('FUTURE_TEST_EVALUATION_CONTRACT_MISMATCH');
  }
  if (!artifact.policyModelId) errors.push('POLICY_MODEL_ID_REQUIRED');
  if (!artifact.policyModelVersion) errors.push('POLICY_MODEL_VERSION_REQUIRED');
  if (!isSha256(artifact.policyManifestSha256)) errors.push('POLICY_MANIFEST_SHA256_INVALID');
  if (!isSha256(artifact.evaluationPlanSha256)) errors.push('EVALUATION_PLAN_SHA256_INVALID');
  if (!isSha256(artifact.evaluationArtifactSha256)) errors.push('EVALUATION_ARTIFACT_SHA256_INVALID');
  if (!artifact.evaluationArtifactRef) errors.push('EVALUATION_ARTIFACT_REF_REQUIRED');
  if (!isIsoDate(artifact.evaluatedAt)) errors.push('EVALUATED_AT_INVALID');
  if (artifact.gateStatus !== 'PASS' && artifact.gateStatus !== 'FAIL') errors.push('GATE_STATUS_INVALID');
  if (artifact.modelSelectionFrozen !== true) errors.push('MODEL_SELECTION_MUST_BE_FROZEN');
  if (artifact.hyperparametersFrozen !== true) errors.push('HYPERPARAMETERS_MUST_BE_FROZEN');
  if (artifact.candidateGeneratorFrozen !== true) errors.push('CANDIDATE_GENERATOR_MUST_BE_FROZEN');
  if (artifact.featureContractFrozen !== true) errors.push('FEATURE_CONTRACT_MUST_BE_FROZEN');
  if (artifact.futureTestAccessCount !== 1) errors.push('FUTURE_TEST_MUST_BE_ACCESSED_EXACTLY_ONCE');
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

export function assertRecommendationFutureTestEvaluationArtifactV1(
  artifact: RecommendationFutureTestEvaluationArtifactV1,
): void {
  const validation = validateRecommendationFutureTestEvaluationArtifactV1(artifact);
  if (!validation.valid) {
    throw new Error(`FUTURE_TEST evaluation artifact is invalid: ${validation.errors.join(',')}`);
  }
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isIsoDate(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
