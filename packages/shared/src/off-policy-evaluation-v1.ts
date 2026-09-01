export const OFF_POLICY_EVALUATION_VERSION = 'off-policy-evaluation-v1' as const;
export const EXACT_ACTION_PROPENSITY_SOURCE = 'RECORDED_AT_ACTION_SELECTION' as const;

export interface LoggedBanditDecisionV1 {
  decisionId: string;
  reward: number;
  loggingPropensity: number;
  loggingPropensitySource: typeof EXACT_ACTION_PROPENSITY_SOURCE;
  targetProbability: number;
  qLogged?: number;
  qTargetExpected?: number;
}

export interface OffPolicyEvaluationConfigV1 {
  maxImportanceWeight?: number;
  minEffectiveSampleSize?: number;
  minEffectiveSampleSizeRatio?: number;
  maxClippedDecisionRate?: number;
  minLoggedPropensity?: number;
}

export interface OffPolicyEvaluationReportV1 {
  version: typeof OFF_POLICY_EVALUATION_VERSION;
  decisionCount: number;
  behaviorMeanReward: number;
  ips: number;
  snips: number;
  doublyRobust?: number;
  doublyRobustUplift?: number;
  doublyRobustUpliftStandardError?: number;
  doublyRobustUpliftCiLow?: number;
  doublyRobustUpliftCiHigh?: number;
  effectiveSampleSize: number;
  effectiveSampleSizeRatio: number;
  minLoggingPropensity: number;
  maxImportanceWeightObserved: number;
  clipped: boolean;
  clippedDecisionCount: number;
  clippedDecisionRate: number;
  passedSupportGate: boolean;
}

export function evaluateOffPolicyV1(
  rows: readonly LoggedBanditDecisionV1[],
  config: OffPolicyEvaluationConfigV1 = {},
): OffPolicyEvaluationReportV1 {
  if (rows.length === 0) throw new Error('OPE requires at least one logged decision');
  const minLoggedPropensityGate = config.minLoggedPropensity ?? 1e-4;
  const minEffectiveSampleSize = config.minEffectiveSampleSize ?? 100;
  const minEffectiveSampleSizeRatio = config.minEffectiveSampleSizeRatio ?? 0.5;
  const maxClippedDecisionRate = config.maxClippedDecisionRate ?? 0.05;
  const maxImportanceWeight = config.maxImportanceWeight;
  validateRate('minEffectiveSampleSizeRatio', minEffectiveSampleSizeRatio);
  validateRate('maxClippedDecisionRate', maxClippedDecisionRate);
  if (!Number.isFinite(minLoggedPropensityGate) || minLoggedPropensityGate <= 0 || minLoggedPropensityGate > 1) {
    throw new Error('minLoggedPropensity must be in (0,1]');
  }
  if (!Number.isFinite(minEffectiveSampleSize) || minEffectiveSampleSize < 0) {
    throw new Error('minEffectiveSampleSize must be non-negative');
  }
  if (maxImportanceWeight !== undefined && (!Number.isFinite(maxImportanceWeight) || maxImportanceWeight <= 0)) {
    throw new Error('maxImportanceWeight must be positive');
  }

  const weights: number[] = [];
  const weightedRewards: number[] = [];
  const drTerms: number[] = [];
  const drUpliftTerms: number[] = [];
  const rewards: number[] = [];
  let minLoggingPropensity = 1;
  let maxImportanceWeightObserved = 0;
  let clippedDecisionCount = 0;
  let allDrInputsAvailable = true;

  for (const row of rows) {
    validateRow(row);
    rewards.push(row.reward);
    minLoggingPropensity = Math.min(minLoggingPropensity, row.loggingPropensity);
    const rawWeight = row.targetProbability / row.loggingPropensity;
    maxImportanceWeightObserved = Math.max(maxImportanceWeightObserved, rawWeight);
    const weight = maxImportanceWeight === undefined ? rawWeight : Math.min(rawWeight, maxImportanceWeight);
    if (weight !== rawWeight) clippedDecisionCount += 1;
    weights.push(weight);
    weightedRewards.push(weight * row.reward);

    if (row.qLogged === undefined || row.qTargetExpected === undefined) {
      allDrInputsAvailable = false;
    } else {
      if (!Number.isFinite(row.qLogged) || !Number.isFinite(row.qTargetExpected)) {
        throw new Error(`Invalid Q estimate for decision ${row.decisionId}`);
      }
      const dr = row.qTargetExpected + weight * (row.reward - row.qLogged);
      drTerms.push(dr);
      drUpliftTerms.push(dr - row.reward);
    }
  }

  const sumWeights = sum(weights);
  const sumSquaredWeights = sum(weights.map((weight) => weight * weight));
  const effectiveSampleSize = sumSquaredWeights > 0 ? (sumWeights * sumWeights) / sumSquaredWeights : 0;
  const effectiveSampleSizeRatio = effectiveSampleSize / rows.length;
  const clippedDecisionRate = clippedDecisionCount / rows.length;
  const ips = mean(weightedRewards);
  const snips = sumWeights > 0 ? sum(weightedRewards) / sumWeights : 0;
  const doublyRobust = allDrInputsAvailable ? mean(drTerms) : undefined;
  const uplift = allDrInputsAvailable ? confidenceInterval95(drUpliftTerms) : undefined;
  const passedSupportGate = minLoggingPropensity >= minLoggedPropensityGate
    && effectiveSampleSize >= minEffectiveSampleSize
    && effectiveSampleSizeRatio >= minEffectiveSampleSizeRatio
    && clippedDecisionRate <= maxClippedDecisionRate;

  return {
    version: OFF_POLICY_EVALUATION_VERSION,
    decisionCount: rows.length,
    behaviorMeanReward: mean(rewards),
    ips,
    snips,
    doublyRobust,
    doublyRobustUplift: uplift?.mean,
    doublyRobustUpliftStandardError: uplift?.standardError,
    doublyRobustUpliftCiLow: uplift?.ciLow,
    doublyRobustUpliftCiHigh: uplift?.ciHigh,
    effectiveSampleSize,
    effectiveSampleSizeRatio,
    minLoggingPropensity,
    maxImportanceWeightObserved,
    clipped: maxImportanceWeight !== undefined,
    clippedDecisionCount,
    clippedDecisionRate,
    passedSupportGate,
  };
}

export interface ValueActionSensitivityInputV1 {
  originalPredictions: readonly number[];
  actionMaskedPredictions: readonly number[];
  candidatePermutedPredictions: readonly number[];
}

export interface ValueActionSensitivityConfigV1 {
  minActionEffectMae?: number;
  minPermutationResponseMae?: number;
}

export interface ValueActionSensitivityReportV1 {
  actionEffectMae: number;
  permutationResponseMae: number;
  originalPredictionStdDev: number;
  passed: boolean;
}

export function evaluateValueActionSensitivityV1(
  input: ValueActionSensitivityInputV1,
  config: ValueActionSensitivityConfigV1 = {},
): ValueActionSensitivityReportV1 {
  const n = input.originalPredictions.length;
  if (n === 0 || input.actionMaskedPredictions.length !== n || input.candidatePermutedPredictions.length !== n) {
    throw new Error('Value sensitivity inputs must be non-empty and aligned');
  }
  const vectors = [input.originalPredictions, input.actionMaskedPredictions, input.candidatePermutedPredictions];
  for (const vector of vectors) {
    if (vector.some((value) => !Number.isFinite(value))) throw new Error('Value sensitivity predictions must be finite');
  }
  const actionEffectMae = mean(input.originalPredictions.map((value, index) => Math.abs(value - input.actionMaskedPredictions[index])));
  const permutationResponseMae = mean(input.originalPredictions.map((value, index) => Math.abs(value - input.candidatePermutedPredictions[index])));
  const originalPredictionStdDev = standardDeviation(input.originalPredictions);
  const minActionEffectMae = config.minActionEffectMae ?? 1e-4;
  const minPermutationResponseMae = config.minPermutationResponseMae ?? 1e-4;
  return {
    actionEffectMae,
    permutationResponseMae,
    originalPredictionStdDev,
    passed: actionEffectMae >= minActionEffectMae && permutationResponseMae >= minPermutationResponseMae,
  };
}

function validateRow(row: LoggedBanditDecisionV1): void {
  if (!row.decisionId) throw new Error('decisionId is required');
  if (!Number.isFinite(row.reward)) throw new Error(`Invalid reward for decision ${row.decisionId}`);
  if (row.loggingPropensitySource !== EXACT_ACTION_PROPENSITY_SOURCE) {
    throw new Error(`Reconstructed logging propensity is forbidden for decision ${row.decisionId}`);
  }
  if (!Number.isFinite(row.loggingPropensity) || row.loggingPropensity <= 0 || row.loggingPropensity > 1) {
    throw new Error(`Invalid logging propensity for decision ${row.decisionId}`);
  }
  if (!Number.isFinite(row.targetProbability) || row.targetProbability < 0 || row.targetProbability > 1) {
    throw new Error(`Invalid target probability for decision ${row.decisionId}`);
  }
}

function confidenceInterval95(values: readonly number[]): {
  mean: number;
  standardError: number;
  ciLow: number;
  ciHigh: number;
} {
  const avg = mean(values);
  const variance = sampleVariance(values);
  const standardError = Math.sqrt(variance / values.length);
  const halfWidth = 1.96 * standardError;
  return { mean: avg, standardError, ciLow: avg - halfWidth, ciHigh: avg + halfWidth };
}

function sampleVariance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return sum(values.map((value) => (value - avg) ** 2)) / (values.length - 1);
}

function validateRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0,1]`);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function standardDeviation(values: readonly number[]): number {
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}
