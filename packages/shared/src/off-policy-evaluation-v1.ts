export const OFF_POLICY_EVALUATION_VERSION = 'off-policy-evaluation-v1' as const;

export interface LoggedBanditDecisionV1 {
  decisionId: string;
  reward: number;
  loggingPropensity: number;
  loggingPropensitySource: 'RECORDED_AT_ASSIGNMENT';
  targetProbability: number;
  qLogged?: number;
  qTargetExpected?: number;
}

export interface OffPolicyEvaluationConfigV1 {
  maxImportanceWeight?: number;
  minEffectiveSampleSize?: number;
  minLoggedPropensity?: number;
}

export interface OffPolicyEvaluationReportV1 {
  version: typeof OFF_POLICY_EVALUATION_VERSION;
  decisionCount: number;
  ips: number;
  snips: number;
  doublyRobust?: number;
  effectiveSampleSize: number;
  minLoggingPropensity: number;
  maxImportanceWeightObserved: number;
  clipped: boolean;
  clippedDecisionCount: number;
  passedSupportGate: boolean;
}

export function evaluateOffPolicyV1(
  rows: readonly LoggedBanditDecisionV1[],
  config: OffPolicyEvaluationConfigV1 = {},
): OffPolicyEvaluationReportV1 {
  if (rows.length === 0) throw new Error('OPE requires at least one logged decision');
  const minLoggedPropensityGate = config.minLoggedPropensity ?? 1e-4;
  const minEffectiveSampleSize = config.minEffectiveSampleSize ?? 100;
  const maxImportanceWeight = config.maxImportanceWeight;
  if (maxImportanceWeight !== undefined && (!Number.isFinite(maxImportanceWeight) || maxImportanceWeight <= 0)) {
    throw new Error('maxImportanceWeight must be positive');
  }

  const weights: number[] = [];
  const weightedRewards: number[] = [];
  const drTerms: number[] = [];
  let minLoggingPropensity = 1;
  let maxImportanceWeightObserved = 0;
  let clippedDecisionCount = 0;
  let allDrInputsAvailable = true;

  for (const row of rows) {
    validateRow(row);
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
      drTerms.push(row.qTargetExpected + weight * (row.reward - row.qLogged));
    }
  }

  const sumWeights = sum(weights);
  const sumSquaredWeights = sum(weights.map((weight) => weight * weight));
  const effectiveSampleSize = sumSquaredWeights > 0 ? (sumWeights * sumWeights) / sumSquaredWeights : 0;
  const ips = mean(weightedRewards);
  const snips = sumWeights > 0 ? sum(weightedRewards) / sumWeights : 0;
  const doublyRobust = allDrInputsAvailable ? mean(drTerms) : undefined;

  return {
    version: OFF_POLICY_EVALUATION_VERSION,
    decisionCount: rows.length,
    ips,
    snips,
    doublyRobust,
    effectiveSampleSize,
    minLoggingPropensity,
    maxImportanceWeightObserved,
    clipped: maxImportanceWeight !== undefined,
    clippedDecisionCount,
    passedSupportGate: minLoggingPropensity >= minLoggedPropensityGate && effectiveSampleSize >= minEffectiveSampleSize,
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
  if (row.loggingPropensitySource !== 'RECORDED_AT_ASSIGNMENT') {
    throw new Error(`Reconstructed logging propensity is forbidden for decision ${row.decisionId}`);
  }
  if (!Number.isFinite(row.loggingPropensity) || row.loggingPropensity <= 0 || row.loggingPropensity > 1) {
    throw new Error(`Invalid logging propensity for decision ${row.decisionId}`);
  }
  if (!Number.isFinite(row.targetProbability) || row.targetProbability < 0 || row.targetProbability > 1) {
    throw new Error(`Invalid target probability for decision ${row.decisionId}`);
  }
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
