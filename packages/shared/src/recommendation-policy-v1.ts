import { RecommendationDecisionCandidateV8 } from './recommendation-telemetry-v8';
import { isSafeFeasibleCandidate } from './recommendation-runtime-v8';

export const RECOMMENDATION_POLICY_V1_CONTRACT = 'recommendation-policy-v1' as const;

export interface RecommendationPolicyV1Config {
  temperature: number;
  behaviorRegularization: number;
  minimumBehaviorSupport?: number;
}

export interface RecommendationPolicyCandidateV1 {
  actionKey: string;
  valueScore: number;
  behaviorProbability: number;
  policyLogit: number;
  policyProbability: number;
}

export interface RecommendationPolicyDistributionV1 {
  contract: typeof RECOMMENDATION_POLICY_V1_CONTRACT;
  candidates: readonly RecommendationPolicyCandidateV1[];
  excludedActionKeys: readonly string[];
  selectedActionKey: string;
  selectedPolicyProbability: number;
}

export function buildRecommendationPolicyDistributionV1(
  candidates: readonly RecommendationDecisionCandidateV8[],
  config: RecommendationPolicyV1Config,
): RecommendationPolicyDistributionV1 {
  validateConfig(config);
  const minimumBehaviorSupport = config.minimumBehaviorSupport ?? 0;
  const supported: Array<{
    candidate: RecommendationDecisionCandidateV8;
    valueScore: number;
    behaviorProbability: number;
    policyLogit: number;
  }> = [];
  const excludedActionKeys: string[] = [];

  for (const candidate of candidates) {
    if (!isSafeFeasibleCandidate(candidate)) {
      excludedActionKeys.push(candidate.actionKey);
      continue;
    }
    const behaviorProbability = candidate.behaviorProbability;
    const valueScore = candidate.valueScore;
    if (
      behaviorProbability === undefined
      || !Number.isFinite(behaviorProbability)
      || behaviorProbability <= minimumBehaviorSupport
      || behaviorProbability <= 0
      || valueScore === undefined
      || !Number.isFinite(valueScore)
    ) {
      excludedActionKeys.push(candidate.actionKey);
      continue;
    }
    const policyLogit = valueScore / config.temperature
      + config.behaviorRegularization * Math.log(behaviorProbability);
    supported.push({ candidate, valueScore, behaviorProbability, policyLogit });
  }

  if (supported.length === 0) throw new Error('Policy V1 has no supported safe candidates');
  const probabilities = stableSoftmax(supported.map((entry) => entry.policyLogit));
  const distribution = supported
    .map((entry, index) => ({
      actionKey: entry.candidate.actionKey,
      valueScore: entry.valueScore,
      behaviorProbability: entry.behaviorProbability,
      policyLogit: entry.policyLogit,
      policyProbability: probabilities[index],
    }))
    .sort((a, b) => b.policyProbability - a.policyProbability || a.actionKey.localeCompare(b.actionKey));
  const selected = distribution[0];

  return {
    contract: RECOMMENDATION_POLICY_V1_CONTRACT,
    candidates: distribution,
    excludedActionKeys: [...new Set(excludedActionKeys)].sort(),
    selectedActionKey: selected.actionKey,
    selectedPolicyProbability: selected.policyProbability,
  };
}

export function attachRecommendationPolicyScoresV1(
  candidates: readonly RecommendationDecisionCandidateV8[],
  distribution: RecommendationPolicyDistributionV1,
): RecommendationDecisionCandidateV8[] {
  const probabilityByAction = new Map(distribution.candidates.map((candidate) => [candidate.actionKey, candidate.policyProbability]));
  return candidates.map((candidate) => ({
    ...candidate,
    policyScore: probabilityByAction.get(candidate.actionKey),
  }));
}

function validateConfig(config: RecommendationPolicyV1Config): void {
  if (!Number.isFinite(config.temperature) || config.temperature <= 0) throw new Error('temperature must be positive');
  if (!Number.isFinite(config.behaviorRegularization) || config.behaviorRegularization < 0) {
    throw new Error('behaviorRegularization must be non-negative');
  }
  if (
    config.minimumBehaviorSupport !== undefined
    && (!Number.isFinite(config.minimumBehaviorSupport) || config.minimumBehaviorSupport < 0 || config.minimumBehaviorSupport >= 1)
  ) {
    throw new Error('minimumBehaviorSupport must be in [0,1)');
  }
}

function stableSoftmax(logits: readonly number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exponentials = logits.map((logit) => Math.exp(logit - maxLogit));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Policy V1 softmax normalization failed');
  return exponentials.map((value) => value / total);
}
