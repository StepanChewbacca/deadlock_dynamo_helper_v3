export const RECOMMENDATION_VALUE_TRAINING_READINESS_VERSION = 'recommendation-value-training-readiness-v1' as const;

export interface RecommendationValueTrainingReadinessInputV1 {
  safeExplorationPhaseUnlocked: boolean;
  exactActionPropensityPassed: boolean;
  safeExplorationSafetyPassed: boolean;
  opeEvidenceSufficient: boolean;
  opeSupportPassed: boolean;
  randomizedDecisionCount: number;
  evaluableDecisionCount: number;
  excludedDecisionCount: number;
  effectiveSampleSize: number;
  effectiveSampleSizeRatio: number;
  clippedDecisionRate: number;
  futureTestUntouched: boolean;
  futureTestEvaluated: boolean;
}

export interface RecommendationValueTrainingReadinessV1 {
  version: typeof RECOMMENDATION_VALUE_TRAINING_READINESS_VERSION;
  ready: boolean;
  blockers: readonly string[];
}

export function evaluateRecommendationValueTrainingReadinessV1(
  input: RecommendationValueTrainingReadinessInputV1,
): RecommendationValueTrainingReadinessV1 {
  validateCount('randomizedDecisionCount', input.randomizedDecisionCount);
  validateCount('evaluableDecisionCount', input.evaluableDecisionCount);
  validateCount('excludedDecisionCount', input.excludedDecisionCount);
  if (!Number.isFinite(input.effectiveSampleSize) || input.effectiveSampleSize < 0) {
    throw new Error('effectiveSampleSize is invalid');
  }
  validateRate('effectiveSampleSizeRatio', input.effectiveSampleSizeRatio);
  validateRate('clippedDecisionRate', input.clippedDecisionRate);

  const blockers: string[] = [];
  if (!input.safeExplorationPhaseUnlocked) blockers.push('SAFE_EXPLORATION_PHASE_NOT_UNLOCKED');
  if (!input.exactActionPropensityPassed) blockers.push('EXACT_ACTION_PROPENSITY_NOT_PASS');
  if (!input.safeExplorationSafetyPassed) blockers.push('SAFE_EXPLORATION_SAFETY_NOT_PASS');
  if (!input.opeEvidenceSufficient) blockers.push('OPE_EVIDENCE_INSUFFICIENT');
  if (!input.opeSupportPassed) blockers.push('OPE_SUPPORT_NOT_PASS');
  if (input.randomizedDecisionCount <= 0) blockers.push('NO_RANDOMIZED_DECISIONS');
  if (input.evaluableDecisionCount <= 0) blockers.push('NO_EVALUABLE_RANDOMIZED_DECISIONS');
  if (input.excludedDecisionCount !== 0) blockers.push('INCOMPLETE_RANDOMIZED_DECISION_SUPPORT');
  if (!input.futureTestUntouched) blockers.push('FUTURE_TEST_INTEGRITY_VIOLATION');
  if (input.futureTestEvaluated) blockers.push('FUTURE_TEST_ALREADY_EVALUATED');

  return {
    version: RECOMMENDATION_VALUE_TRAINING_READINESS_VERSION,
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
  };
}

function validateCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} is invalid`);
}

function validateRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0,1]`);
}
