import { RecommendationBehavioralV8ModelFamily } from './recommendation-behavioral-v8';

export const RECOMMENDATION_BEHAVIORAL_ABLATION_VERSION = 'recommendation-behavioral-ablation-v1' as const;

export interface RecommendationBehavioralArchitectureResultV1 {
  family: RecommendationBehavioralV8ModelFamily;
  modelVersion: string;
  datasetSha256: string;
  featureContractVersion: string;
  candidateGeneratorVersion: string;
  decisionCount: number;
  rawLogLoss: number;
  support: number;
  majorCohortSupportMin: number;
  probabilityFloorApplied: boolean;
}

export interface RecommendationBehavioralAblationConfigV1 {
  minDecisionCount: number;
  minSupport: number;
  minMajorCohortSupport: number;
  minTransformerLogLossImprovement: number;
  minTransformerMajorCohortSupportGain: number;
}

export const DEFAULT_RECOMMENDATION_BEHAVIORAL_ABLATION_CONFIG_V1: RecommendationBehavioralAblationConfigV1 = {
  minDecisionCount: 10_000,
  minSupport: 0.90,
  minMajorCohortSupport: 0.75,
  minTransformerLogLossImprovement: 1e-6,
  minTransformerMajorCohortSupportGain: 1e-6,
};

export interface RecommendationBehavioralAblationReportV1 {
  version: typeof RECOMMENDATION_BEHAVIORAL_ABLATION_VERSION;
  passed: boolean;
  equalObservables: boolean;
  transformerLogLossImprovement: number;
  transformerMajorCohortSupportGain: number;
  blockers: readonly string[];
}

export function evaluateRecommendationBehavioralAblationV1(
  baseline: RecommendationBehavioralArchitectureResultV1,
  transformer: RecommendationBehavioralArchitectureResultV1,
  config: RecommendationBehavioralAblationConfigV1 = DEFAULT_RECOMMENDATION_BEHAVIORAL_ABLATION_CONFIG_V1,
): RecommendationBehavioralAblationReportV1 {
  validateResult(baseline);
  validateResult(transformer);
  validateConfig(config);
  const blockers: string[] = [];
  if (transformer.family !== 'SEQUENCE_TRANSFORMER') blockers.push('TRANSFORMER_RESULT_REQUIRED');
  if (baseline.family === 'SEQUENCE_TRANSFORMER') blockers.push('BASELINE_MUST_NOT_BE_TRANSFORMER');
  const equalObservables = baseline.datasetSha256 === transformer.datasetSha256
    && baseline.featureContractVersion === transformer.featureContractVersion
    && baseline.candidateGeneratorVersion === transformer.candidateGeneratorVersion
    && baseline.decisionCount === transformer.decisionCount;
  if (!equalObservables) blockers.push('EQUAL_OBSERVABLES_CONTRACT_MISMATCH');
  if (transformer.decisionCount < config.minDecisionCount) blockers.push('TRANSFORMER_DECISION_COUNT_TOO_LOW');
  if (transformer.support < config.minSupport) blockers.push('TRANSFORMER_SUPPORT_BELOW_GATE');
  if (transformer.majorCohortSupportMin < config.minMajorCohortSupport) blockers.push('TRANSFORMER_MAJOR_COHORT_SUPPORT_BELOW_GATE');
  if (baseline.probabilityFloorApplied || transformer.probabilityFloorApplied) blockers.push('PROBABILITY_FLOOR_FORBIDDEN');

  const transformerLogLossImprovement = baseline.rawLogLoss - transformer.rawLogLoss;
  const transformerMajorCohortSupportGain = transformer.majorCohortSupportMin - baseline.majorCohortSupportMin;
  if (transformerLogLossImprovement < config.minTransformerLogLossImprovement) blockers.push('TRANSFORMER_LOGLOSS_GAIN_NOT_PROVEN');
  if (transformerMajorCohortSupportGain < config.minTransformerMajorCohortSupportGain) blockers.push('TRANSFORMER_COHORT_GAIN_NOT_PROVEN');

  return {
    version: RECOMMENDATION_BEHAVIORAL_ABLATION_VERSION,
    passed: blockers.length === 0,
    equalObservables,
    transformerLogLossImprovement,
    transformerMajorCohortSupportGain,
    blockers: [...new Set(blockers)].sort(),
  };
}

function validateResult(result: RecommendationBehavioralArchitectureResultV1): void {
  if (!result.modelVersion) throw new Error('modelVersion is required');
  if (!isSha256(result.datasetSha256)) throw new Error('datasetSha256 is invalid');
  if (!result.featureContractVersion) throw new Error('featureContractVersion is required');
  if (!result.candidateGeneratorVersion) throw new Error('candidateGeneratorVersion is required');
  if (!Number.isInteger(result.decisionCount) || result.decisionCount < 0) throw new Error('decisionCount is invalid');
  if (!Number.isFinite(result.rawLogLoss) || result.rawLogLoss < 0) throw new Error('rawLogLoss is invalid');
  validateRate('support', result.support);
  validateRate('majorCohortSupportMin', result.majorCohortSupportMin);
}

function validateConfig(config: RecommendationBehavioralAblationConfigV1): void {
  if (!Number.isInteger(config.minDecisionCount) || config.minDecisionCount < 1) throw new Error('minDecisionCount is invalid');
  validateRate('minSupport', config.minSupport);
  validateRate('minMajorCohortSupport', config.minMajorCohortSupport);
  if (!Number.isFinite(config.minTransformerLogLossImprovement) || config.minTransformerLogLossImprovement < 0) {
    throw new Error('minTransformerLogLossImprovement is invalid');
  }
  if (!Number.isFinite(config.minTransformerMajorCohortSupportGain) || config.minTransformerMajorCohortSupportGain < 0) {
    throw new Error('minTransformerMajorCohortSupportGain is invalid');
  }
}

function validateRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0,1]`);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}
