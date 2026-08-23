import {
  RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1,
  RecommendationBehavioralTrainingConfigV1,
} from './recommendation-behavioral-training-v1';

export const RECOMMENDATION_BEHAVIORAL_TRAINING_PAIR_V1 = 'recommendation-behavioral-training-pair-v1' as const;

export const RECOMMENDATION_BEHAVIORAL_EQUAL_OBSERVABLE_FIELDS_V1 = [
  'seed',
  'deterministic',
  'trainSplit',
  'validationSplit',
  'selectionSplit',
  'futureTestAllowed',
  'device',
  'hashDimension',
  'maximumHistoryEvents',
  'embeddingDimension',
  'hiddenDimension',
  'layerCount',
  'dropout',
  'supportProbabilityThreshold',
  'majorCohortMinDecisions',
  'majorCohortMinFraction',
  'gateMinDecisions',
  'gateMinCandidateCoverage',
  'gateMinSupport',
  'gateMinMajorCohortSupport',
  'gateMaxFloorSensitivity',
] as const satisfies readonly (keyof RecommendationBehavioralTrainingConfigV1)[];

export interface RecommendationBehavioralTrainingPairValidationV1 {
  contractVersion: typeof RECOMMENDATION_BEHAVIORAL_TRAINING_PAIR_V1;
  valid: boolean;
  errors: readonly string[];
}

export function validateRecommendationBehavioralTrainingPairV1(
  rnn: RecommendationBehavioralTrainingConfigV1,
  transformer: RecommendationBehavioralTrainingConfigV1,
): RecommendationBehavioralTrainingPairValidationV1 {
  const errors: string[] = [];
  if (rnn?.contractVersion !== RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1) {
    errors.push('RNN_TRAINING_CONFIG_CONTRACT_MISMATCH');
  }
  if (transformer?.contractVersion !== RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1) {
    errors.push('TRANSFORMER_TRAINING_CONFIG_CONTRACT_MISMATCH');
  }
  if (rnn?.family !== 'SEQUENCE_RNN') errors.push('RNN_CONFIG_FAMILY_REQUIRED');
  if (transformer?.family !== 'SEQUENCE_TRANSFORMER') errors.push('TRANSFORMER_CONFIG_FAMILY_REQUIRED');

  for (const field of RECOMMENDATION_BEHAVIORAL_EQUAL_OBSERVABLE_FIELDS_V1) {
    if (JSON.stringify(rnn?.[field]) !== JSON.stringify(transformer?.[field])) {
      errors.push(`EQUAL_OBSERVABLES_CONFIG_MISMATCH:${field}`);
    }
  }
  return {
    contractVersion: RECOMMENDATION_BEHAVIORAL_TRAINING_PAIR_V1,
    valid: errors.length === 0,
    errors: [...new Set(errors)].sort(),
  };
}

export function assertRecommendationBehavioralTrainingPairV1(
  rnn: RecommendationBehavioralTrainingConfigV1,
  transformer: RecommendationBehavioralTrainingConfigV1,
): void {
  const validation = validateRecommendationBehavioralTrainingPairV1(rnn, transformer);
  if (!validation.valid) {
    throw new Error(`Behavioral equal-observables training pair is invalid: ${validation.errors.join(',')}`);
  }
}
