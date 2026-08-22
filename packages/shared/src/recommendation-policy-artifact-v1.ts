import { RecommendationPolicyV1Config } from './recommendation-policy-v1';

export const RECOMMENDATION_POLICY_ARTIFACT_V1 = 'recommendation-policy-artifact-v1' as const;

export interface RecommendationPolicyUpstreamModelV1 {
  modelId: string;
  modelVersion: string;
  modelKind: 'BEHAVIORAL' | 'VALUE';
  manifestSha256: string;
}

export interface RecommendationPolicyArtifactV1 {
  contractVersion: typeof RECOMMENDATION_POLICY_ARTIFACT_V1;
  policyConfig: RecommendationPolicyV1Config & { minimumBehaviorSupport: number };
  behavioral: RecommendationPolicyUpstreamModelV1 & { modelKind: 'BEHAVIORAL' };
  value: RecommendationPolicyUpstreamModelV1 & { modelKind: 'VALUE' };
  featureContractVersion: string;
  actionContractVersion: string;
  candidateGeneratorVersion: string;
  supportedRulesetVersions: readonly string[];
  supportedCatalogSha256: readonly string[];
  futureTestEvaluated: false;
}

export interface RecommendationPolicyArtifactValidationV1 {
  valid: boolean;
  errors: readonly string[];
}

export function validateRecommendationPolicyArtifactV1(
  artifact: RecommendationPolicyArtifactV1,
): RecommendationPolicyArtifactValidationV1 {
  const errors: string[] = [];
  if (artifact.contractVersion !== RECOMMENDATION_POLICY_ARTIFACT_V1) errors.push('POLICY_ARTIFACT_CONTRACT_MISMATCH');
  validateUpstream(artifact.behavioral, 'BEHAVIORAL', errors);
  validateUpstream(artifact.value, 'VALUE', errors);
  if (!artifact.featureContractVersion) errors.push('FEATURE_CONTRACT_VERSION_REQUIRED');
  if (!artifact.actionContractVersion) errors.push('ACTION_CONTRACT_VERSION_REQUIRED');
  if (!artifact.candidateGeneratorVersion) errors.push('CANDIDATE_GENERATOR_VERSION_REQUIRED');
  if (artifact.supportedRulesetVersions.length === 0) errors.push('SUPPORTED_RULESET_REQUIRED');
  if (artifact.supportedCatalogSha256.length === 0) errors.push('SUPPORTED_CATALOG_REQUIRED');
  for (const sha of artifact.supportedCatalogSha256) if (!isSha256(sha)) errors.push(`SUPPORTED_CATALOG_SHA_INVALID:${sha}`);
  if (artifact.futureTestEvaluated !== false) errors.push('FUTURE_TEST_MUST_BE_UNTOUCHED');
  const config = artifact.policyConfig;
  if (!Number.isFinite(config.temperature) || config.temperature <= 0) errors.push('POLICY_TEMPERATURE_INVALID');
  if (!Number.isFinite(config.behaviorRegularization) || config.behaviorRegularization < 0) {
    errors.push('POLICY_BEHAVIOR_REGULARIZATION_INVALID');
  }
  if (!Number.isFinite(config.minimumBehaviorSupport)
    || config.minimumBehaviorSupport <= 0
    || config.minimumBehaviorSupport >= 1) {
    errors.push('POLICY_MINIMUM_BEHAVIOR_SUPPORT_REQUIRED');
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

export function assertRecommendationPolicyArtifactV1(artifact: RecommendationPolicyArtifactV1): void {
  const validation = validateRecommendationPolicyArtifactV1(artifact);
  if (!validation.valid) throw new Error(`Recommendation Policy artifact is invalid: ${validation.errors.join(',')}`);
}

function validateUpstream(
  upstream: RecommendationPolicyUpstreamModelV1,
  expectedKind: RecommendationPolicyUpstreamModelV1['modelKind'],
  errors: string[],
): void {
  if (!upstream.modelId) errors.push(`${expectedKind}_MODEL_ID_REQUIRED`);
  if (!upstream.modelVersion) errors.push(`${expectedKind}_MODEL_VERSION_REQUIRED`);
  if (upstream.modelKind !== expectedKind) errors.push(`${expectedKind}_MODEL_KIND_MISMATCH`);
  if (!isSha256(upstream.manifestSha256)) errors.push(`${expectedKind}_MANIFEST_SHA256_INVALID`);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}
