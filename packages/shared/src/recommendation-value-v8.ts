import {
  RecommendationActionFeatureV8,
  RecommendationFeatureStateV8,
  recommendationActionTokensV8,
  recommendationHistoryTokensV8,
  recommendationStateTokensV8,
  validateRecommendationFeatureStateV8,
} from './recommendation-feature-store-v8';
import { EXACT_ACTION_PROPENSITY_SOURCE } from './off-policy-evaluation-v1';

export const RECOMMENDATION_VALUE_V8_CONTRACT = 'recommendation-value-v8' as const;
export const RECOMMENDATION_VALUE_V8_OBJECTIVE = 'INVERSE_PROPENSITY_WEIGHTED_ACTION_VALUE_REGRESSION' as const;

export interface RecommendationValueV8Model {
  contract: typeof RECOMMENDATION_VALUE_V8_CONTRACT;
  modelVersion: string;
  featureContractVersion: string;
  objective: typeof RECOMMENDATION_VALUE_V8_OBJECTIVE;
  hashDimension: number;
  weights: number[];
  bias: number;
  trainedDecisionCount: number;
}

export interface RecommendationValueTrainingExampleV8 {
  decisionId: string;
  state: RecommendationFeatureStateV8;
  action: RecommendationActionFeatureV8;
  reward: number;
  actionLoggingPropensity: number;
  loggingPropensitySource: typeof EXACT_ACTION_PROPENSITY_SOURCE;
}

export interface RecommendationValueTrainingOptionsV8 {
  learningRate: number;
  l2: number;
  gradientClip: number;
  maxImportanceWeight?: number;
  historyMaximumEvents?: number;
}

export interface RecommendationValuePredictionV8 {
  actionKey: string;
  value: number;
}

export interface RecommendationValueEvaluationV8 {
  decisionCount: number;
  weightedMse: number;
  unweightedMse: number;
  effectiveSampleSize: number;
  maxImportanceWeightObserved: number;
}

export function createRecommendationValueV8Model(
  modelVersion: string,
  featureContractVersion: string,
  hashDimension = 16_384,
): RecommendationValueV8Model {
  if (!modelVersion) throw new Error('modelVersion is required');
  if (!featureContractVersion) throw new Error('featureContractVersion is required');
  if (!Number.isInteger(hashDimension) || hashDimension < 128) throw new Error('hashDimension must be an integer >= 128');
  return {
    contract: RECOMMENDATION_VALUE_V8_CONTRACT,
    modelVersion,
    featureContractVersion,
    objective: RECOMMENDATION_VALUE_V8_OBJECTIVE,
    hashDimension,
    weights: new Array(hashDimension).fill(0),
    bias: 0,
    trainedDecisionCount: 0,
  };
}

export function predictRecommendationValueV8(
  model: RecommendationValueV8Model,
  state: RecommendationFeatureStateV8,
  action: RecommendationActionFeatureV8,
  historyMaximumEvents = 64,
): RecommendationValuePredictionV8 {
  validateModel(model);
  const validation = validateRecommendationFeatureStateV8(state);
  if (!validation.valid) throw new Error(`Invalid recommendation feature state: ${validation.errors.join(',')}`);
  const indices = featureIndices(model, state, action, historyMaximumEvents);
  const value = indices.reduce((sum, index) => sum + model.weights[index], model.bias);
  return { actionKey: action.actionKey, value };
}

export function trainRecommendationValueV8Example(
  model: RecommendationValueV8Model,
  example: RecommendationValueTrainingExampleV8,
  options: RecommendationValueTrainingOptionsV8,
): number {
  validateModel(model);
  validateExample(example);
  validateOptions(options);
  const indices = featureIndices(model, example.state, example.action, options.historyMaximumEvents ?? 64);
  const prediction = indices.reduce((sum, index) => sum + model.weights[index], model.bias);
  const residual = example.reward - prediction;
  const rawImportanceWeight = 1 / example.actionLoggingPropensity;
  const importanceWeight = options.maxImportanceWeight === undefined
    ? rawImportanceWeight
    : Math.min(rawImportanceWeight, options.maxImportanceWeight);
  const gradientScale = clip(importanceWeight * residual, options.gradientClip);
  for (const index of indices) {
    const current = model.weights[index];
    model.weights[index] += options.learningRate * (gradientScale - options.l2 * current);
  }
  model.bias += options.learningRate * gradientScale;
  model.trainedDecisionCount += 1;
  return importanceWeight * residual * residual;
}

export function evaluateRecommendationValueV8(
  model: RecommendationValueV8Model,
  examples: readonly RecommendationValueTrainingExampleV8[],
  options: { maxImportanceWeight?: number; historyMaximumEvents?: number } = {},
): RecommendationValueEvaluationV8 {
  if (examples.length === 0) throw new Error('Value evaluation requires at least one example');
  const weightedErrors: number[] = [];
  const unweightedErrors: number[] = [];
  const weights: number[] = [];
  let maxImportanceWeightObserved = 0;
  for (const example of examples) {
    validateExample(example);
    const prediction = predictRecommendationValueV8(
      model,
      example.state,
      example.action,
      options.historyMaximumEvents ?? 64,
    ).value;
    const error = example.reward - prediction;
    const rawWeight = 1 / example.actionLoggingPropensity;
    maxImportanceWeightObserved = Math.max(maxImportanceWeightObserved, rawWeight);
    const weight = options.maxImportanceWeight === undefined ? rawWeight : Math.min(rawWeight, options.maxImportanceWeight);
    weights.push(weight);
    weightedErrors.push(weight * error * error);
    unweightedErrors.push(error * error);
  }
  const sumWeights = sum(weights);
  const sumSquaredWeights = sum(weights.map((weight) => weight * weight));
  return {
    decisionCount: examples.length,
    weightedMse: sumWeights > 0 ? sum(weightedErrors) / sumWeights : 0,
    unweightedMse: mean(unweightedErrors),
    effectiveSampleSize: sumSquaredWeights > 0 ? (sumWeights * sumWeights) / sumSquaredWeights : 0,
    maxImportanceWeightObserved,
  };
}

export function valueActionResidualVarianceV8(
  model: RecommendationValueV8Model,
  state: RecommendationFeatureStateV8,
  actions: readonly RecommendationActionFeatureV8[],
): number {
  if (actions.length < 2) return 0;
  const values = actions.map((action) => predictRecommendationValueV8(model, state, action).value);
  const avg = mean(values);
  return mean(values.map((value) => (value - avg) ** 2));
}

function featureIndices(
  model: RecommendationValueV8Model,
  state: RecommendationFeatureStateV8,
  action: RecommendationActionFeatureV8,
  historyMaximumEvents: number,
): number[] {
  const stateTokens = recommendationStateTokensV8(state);
  const actionTokens = recommendationActionTokensV8(action);
  const historyTokens = recommendationHistoryTokensV8(state, historyMaximumEvents);
  const indices = new Set<number>();
  for (const token of stateTokens) indices.add(hashToken(`S:${token}`, model.hashDimension));
  for (const token of actionTokens) indices.add(hashToken(`A:${token}`, model.hashDimension));
  for (const token of historyTokens) indices.add(hashToken(`H:${token}`, model.hashDimension));
  for (const stateToken of stateTokens) {
    for (const actionToken of actionTokens) {
      indices.add(hashToken(`SA:${stateToken}|${actionToken}`, model.hashDimension));
    }
  }
  for (const historyToken of historyTokens.slice(Math.max(0, historyTokens.length - 16))) {
    for (const actionToken of actionTokens) {
      indices.add(hashToken(`HA:${historyToken}|${actionToken}`, model.hashDimension));
    }
  }
  return [...indices].sort((a, b) => a - b);
}

function validateModel(model: RecommendationValueV8Model): void {
  if (model.contract !== RECOMMENDATION_VALUE_V8_CONTRACT) throw new Error('Value V8 model contract mismatch');
  if (model.objective !== RECOMMENDATION_VALUE_V8_OBJECTIVE) throw new Error('Value V8 objective mismatch');
  if (model.weights.length !== model.hashDimension) throw new Error('Value V8 model shape mismatch');
  if (!Number.isFinite(model.bias) || model.weights.some((weight) => !Number.isFinite(weight))) {
    throw new Error('Value V8 model contains non-finite parameters');
  }
}

function validateExample(example: RecommendationValueTrainingExampleV8): void {
  if (!example.decisionId) throw new Error('decisionId is required');
  if (!Number.isFinite(example.reward)) throw new Error(`Invalid reward for ${example.decisionId}`);
  if (example.loggingPropensitySource !== EXACT_ACTION_PROPENSITY_SOURCE) {
    throw new Error(`Reconstructed action propensity is forbidden for ${example.decisionId}`);
  }
  if (!Number.isFinite(example.actionLoggingPropensity) || example.actionLoggingPropensity <= 0 || example.actionLoggingPropensity > 1) {
    throw new Error(`Invalid actionLoggingPropensity for ${example.decisionId}`);
  }
}

function validateOptions(options: RecommendationValueTrainingOptionsV8): void {
  if (!Number.isFinite(options.learningRate) || options.learningRate <= 0) throw new Error('learningRate must be positive');
  if (!Number.isFinite(options.l2) || options.l2 < 0) throw new Error('l2 must be non-negative');
  if (!Number.isFinite(options.gradientClip) || options.gradientClip <= 0) throw new Error('gradientClip must be positive');
  if (options.maxImportanceWeight !== undefined && (!Number.isFinite(options.maxImportanceWeight) || options.maxImportanceWeight <= 0)) {
    throw new Error('maxImportanceWeight must be positive');
  }
}

function hashToken(token: string, dimension: number): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % dimension;
}

function clip(value: number, absoluteLimit: number): number {
  return Math.max(-absoluteLimit, Math.min(absoluteLimit, value));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}
