export const RECOMMENDATION_EXPERIMENT_ASSIGNMENT_VERSION = 'recommendation-experiment-v1' as const;

export interface RecommendationExperimentArmV1 {
  arm: string;
  probability: number;
}

export interface RecommendationExperimentAssignmentV1 {
  experimentId: string;
  arm: string;
  assignmentUnit: 'MATCH';
  armAssignmentPropensity: number;
  randomized: boolean;
  assignmentVersion: typeof RECOMMENDATION_EXPERIMENT_ASSIGNMENT_VERSION;
  deterministicBucket: number;
}

export interface SafeExplorationCandidateV1 {
  actionKey: string;
  legal: boolean;
  telemetryFresh: boolean;
  feasibilityKnown: boolean;
  probability: number;
}

export function assignRecommendationExperimentByMatchV1(
  experimentId: string,
  matchId: string,
  arms: readonly RecommendationExperimentArmV1[],
): RecommendationExperimentAssignmentV1 {
  if (!experimentId) throw new Error('experimentId is required');
  if (!matchId) throw new Error('matchId is required');
  validateProbabilityVector(arms.map((arm) => ({ key: arm.arm, probability: arm.probability })));

  const bucket = deterministicUnitInterval(`${experimentId}:${matchId}`);
  let cumulative = 0;
  for (let index = 0; index < arms.length; index += 1) {
    const arm = arms[index];
    cumulative += arm.probability;
    if (bucket < cumulative || index === arms.length - 1) {
      return {
        experimentId,
        arm: arm.arm,
        assignmentUnit: 'MATCH',
        armAssignmentPropensity: arm.probability,
        randomized: arms.length > 1,
        assignmentVersion: RECOMMENDATION_EXPERIMENT_ASSIGNMENT_VERSION,
        deterministicBucket: bucket,
      };
    }
  }

  throw new Error('No experiment arm selected');
}

export function selectSafeExplorationActionV1(
  experimentId: string,
  matchId: string,
  decisionId: string,
  candidates: readonly SafeExplorationCandidateV1[],
): { actionKey: string; actionLoggingPropensity: number; selectionBucket: number } {
  if (!experimentId) throw new Error('experimentId is required');
  if (!matchId) throw new Error('matchId is required');
  if (!decisionId) throw new Error('decisionId is required');
  if (candidates.length < 2) throw new Error('Safe exploration requires at least two candidates');
  for (const candidate of candidates) {
    if (!candidate.legal) throw new Error(`Unsafe exploration candidate ${candidate.actionKey}: ILLEGAL`);
    if (!candidate.telemetryFresh) throw new Error(`Unsafe exploration candidate ${candidate.actionKey}: STALE_TELEMETRY`);
    if (!candidate.feasibilityKnown) throw new Error(`Unsafe exploration candidate ${candidate.actionKey}: UNKNOWN_FEASIBILITY`);
  }
  validateProbabilityVector(candidates.map((candidate) => ({
    key: candidate.actionKey,
    probability: candidate.probability,
  })));

  const bucket = deterministicUnitInterval(`${experimentId}:${matchId}:${decisionId}:action`);
  let cumulative = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    cumulative += candidate.probability;
    if (bucket < cumulative || index === candidates.length - 1) {
      return {
        actionKey: candidate.actionKey,
        actionLoggingPropensity: candidate.probability,
        selectionBucket: bucket,
      };
    }
  }
  throw new Error('No safe exploration action selected');
}

export function deterministicUnitInterval(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x100000000;
}

function validateProbabilityVector(entries: readonly { key: string; probability: number }[]): void {
  if (entries.length === 0) throw new Error('Probability vector must not be empty');
  const keys = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    if (!entry.key) throw new Error('Probability vector key is required');
    if (keys.has(entry.key)) throw new Error(`Duplicate probability vector key ${entry.key}`);
    keys.add(entry.key);
    if (!Number.isFinite(entry.probability) || entry.probability <= 0 || entry.probability > 1) {
      throw new Error(`Invalid probability for ${entry.key}`);
    }
    total += entry.probability;
  }
  if (Math.abs(total - 1) > 1e-12) throw new Error(`Probability vector must sum to 1, got ${total}`);
}
