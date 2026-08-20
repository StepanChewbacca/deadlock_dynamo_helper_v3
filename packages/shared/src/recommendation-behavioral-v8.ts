import {
  RecommendationActionFeatureV8,
  RecommendationFeatureStateV8,
  recommendationActionTokensV8,
  recommendationHistoryTokensV8,
  recommendationStateTokensV8,
} from './recommendation-feature-store-v8';

export const RECOMMENDATION_BEHAVIORAL_V8_CONTRACT = 'recommendation-behavioral-v8' as const;
export const RECOMMENDATION_BEHAVIORAL_V8_PROBABILITY_CONTRACT = 'RAW_SOFTMAX_FEASIBLE_CHOICE_SET' as const;
export const RECOMMENDATION_BEHAVIORAL_V8_OBJECTIVE = 'GROUPED_LISTWISE_CROSS_ENTROPY' as const;

export type RecommendationBehavioralV8ModelFamily =
  | 'CONDITIONAL_LINEAR'
  | 'SEQUENCE_RNN'
  | 'SEQUENCE_TRANSFORMER';

export interface RecommendationBehavioralV8Candidate extends RecommendationActionFeatureV8 {
  feasible: true;
}

export interface RecommendationBehavioralV8Decision {
  decisionId: string;
  state: RecommendationFeatureStateV8;
  candidates: readonly RecommendationBehavioralV8Candidate[];
  observedActionKey?: string;
}

export interface RecommendationBehavioralV8CandidatePrediction {
  actionKey: string;
  score: number;
  probability: number;
  rank: number;
}

export interface RecommendationBehavioralV8Prediction {
  decisionId: string;
  probabilityContract: typeof RECOMMENDATION_BEHAVIORAL_V8_PROBABILITY_CONTRACT;
  candidates: readonly RecommendationBehavioralV8CandidatePrediction[];
  entropy: number;
  observedActionProbability?: number;
}

export interface RecommendationBehavioralV8LinearModel {
  contract: typeof RECOMMENDATION_BEHAVIORAL_V8_CONTRACT;
  family: 'CONDITIONAL_LINEAR';
  modelVersion: string;
  featureContractVersion: string;
  probabilityContract: typeof RECOMMENDATION_BEHAVIORAL_V8_PROBABILITY_CONTRACT;
  objective: typeof RECOMMENDATION_BEHAVIORAL_V8_OBJECTIVE;
  hashDimension: number;
  weights: number[];
  biasByActionHash: number[];
  trainedDecisionCount: number;
}

export interface RecommendationBehavioralV8TrainingOptions {
  learningRate: number;
  l2: number;
  gradientClip: number;
  historyMaximumEvents?: number;
}

export interface RecommendationBehavioralV8Evaluation {
  decisionCount: number;
  labeledDecisionCount: number;
  coveredDecisionCount: number;
  candidateCoverage: number;
  support: number;
  rawLogLoss: number;
  top1Accuracy: number;
  meanEntropy: number;
  probabilityFloorApplied: false;
}

export function createRecommendationBehavioralV8LinearModel(
  modelVersion: string,
  featureContractVersion: string,
  hashDimension = 16_384,
): RecommendationBehavioralV8LinearModel {
  if (!modelVersion) throw new Error('modelVersion is required');
  if (!featureContractVersion) throw new Error('featureContractVersion is required');
  if (!Number.isInteger(hashDimension) || hashDimension < 128) throw new Error('hashDimension must be an integer >= 128');
  return {
    contract: RECOMMENDATION_BEHAVIORAL_V8_CONTRACT,
    family: 'CONDITIONAL_LINEAR',
    modelVersion,
    featureContractVersion,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V8_PROBABILITY_CONTRACT,
    objective: RECOMMENDATION_BEHAVIORAL_V8_OBJECTIVE,
    hashDimension,
    weights: new Array(hashDimension).fill(0),
    biasByActionHash: new Array(hashDimension).fill(0),
    trainedDecisionCount: 0,
  };
}

export function predictRecommendationBehavioralV8Linear(
  model: RecommendationBehavioralV8LinearModel,
  decision: RecommendationBehavioralV8Decision,
): RecommendationBehavioralV8Prediction {
  validateModel(model);
  validateDecision(decision);
  const stateTokens = recommendationStateTokensV8(decision.state);
  const historyTokens = recommendationHistoryTokensV8(decision.state);
  const scored = decision.candidates.map((candidate) => ({
    actionKey: candidate.actionKey,
    score: scoreCandidate(model, stateTokens, historyTokens, candidate),
  }));
  const probabilities = stableSoftmax(scored.map((entry) => entry.score));
  const ranked = scored
    .map((entry, index) => ({ ...entry, probability: probabilities[index], rank: 0 }))
    .sort((a, b) => b.probability - a.probability || a.actionKey.localeCompare(b.actionKey))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  const observed = decision.observedActionKey
    ? ranked.find((candidate) => candidate.actionKey === decision.observedActionKey)
    : undefined;
  return {
    decisionId: decision.decisionId,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V8_PROBABILITY_CONTRACT,
    candidates: ranked,
    entropy: -ranked.reduce(
      (sum, candidate) => sum + (candidate.probability > 0 ? candidate.probability * Math.log(candidate.probability) : 0),
      0,
    ),
    observedActionProbability: observed?.probability,
  };
}

export function trainRecommendationBehavioralV8LinearDecision(
  model: RecommendationBehavioralV8LinearModel,
  decision: RecommendationBehavioralV8Decision,
  options: RecommendationBehavioralV8TrainingOptions,
): number {
  validateModel(model);
  validateDecision(decision);
  validateTrainingOptions(options);
  if (!decision.observedActionKey) throw new Error('Training decision requires observedActionKey');
  const observedIndex = decision.candidates.findIndex((candidate) => candidate.actionKey === decision.observedActionKey);
  if (observedIndex < 0) throw new Error('Observed action is outside the feasible candidate set');

  const stateTokens = recommendationStateTokensV8(decision.state);
  const historyTokens = recommendationHistoryTokensV8(decision.state, options.historyMaximumEvents ?? 64);
  const candidateFeatures = decision.candidates.map((candidate) => candidateFeatureIndices(model, stateTokens, historyTokens, candidate));
  const scores = decision.candidates.map((candidate, index) =>
    scoreCandidateFromIndices(model, candidate, candidateFeatures[index]),
  );
  const probabilities = stableSoftmax(scores);

  for (let candidateIndex = 0; candidateIndex < decision.candidates.length; candidateIndex += 1) {
    const candidate = decision.candidates[candidateIndex];
    const error = (candidateIndex === observedIndex ? 1 : 0) - probabilities[candidateIndex];
    for (const featureIndex of candidateFeatures[candidateIndex]) {
      const current = model.weights[featureIndex];
      const gradient = error - options.l2 * current;
      model.weights[featureIndex] += options.learningRate * clip(gradient, options.gradientClip);
    }
    const biasIndex = hashToken(`BIAS:${candidate.actionKey}`, model.hashDimension);
    const currentBias = model.biasByActionHash[biasIndex];
    model.biasByActionHash[biasIndex] += options.learningRate * clip(error - options.l2 * currentBias, options.gradientClip);
  }
  model.trainedDecisionCount += 1;
  return -Math.log(probabilities[observedIndex]);
}

export function evaluateRecommendationBehavioralV8Linear(
  model: RecommendationBehavioralV8LinearModel,
  decisions: readonly RecommendationBehavioralV8Decision[],
): RecommendationBehavioralV8Evaluation {
  let labeledDecisionCount = 0;
  let coveredDecisionCount = 0;
  let logLossSum = 0;
  let top1Correct = 0;
  let entropySum = 0;
  for (const decision of decisions) {
    const prediction = predictRecommendationBehavioralV8Linear(model, decision);
    entropySum += prediction.entropy;
    if (!decision.observedActionKey) continue;
    labeledDecisionCount += 1;
    const observed = prediction.candidates.find((candidate) => candidate.actionKey === decision.observedActionKey);
    if (!observed) continue;
    coveredDecisionCount += 1;
    logLossSum += -Math.log(observed.probability);
    if (prediction.candidates[0]?.actionKey === decision.observedActionKey) top1Correct += 1;
  }
  return {
    decisionCount: decisions.length,
    labeledDecisionCount,
    coveredDecisionCount,
    candidateCoverage: ratio(coveredDecisionCount, labeledDecisionCount),
    support: ratio(coveredDecisionCount, labeledDecisionCount),
    rawLogLoss: ratio(logLossSum, coveredDecisionCount),
    top1Accuracy: ratio(top1Correct, coveredDecisionCount),
    meanEntropy: ratio(entropySum, decisions.length),
    probabilityFloorApplied: false,
  };
}

export function validateRawBehaviorProbabilityVectorV8(
  prediction: RecommendationBehavioralV8Prediction,
  tolerance = 1e-9,
): void {
  if (prediction.candidates.length === 0) throw new Error('Behavior prediction candidate set is empty');
  let sum = 0;
  for (const candidate of prediction.candidates) {
    if (!Number.isFinite(candidate.probability) || candidate.probability < 0 || candidate.probability > 1) {
      throw new Error(`Invalid raw behavior probability for ${candidate.actionKey}`);
    }
    sum += candidate.probability;
  }
  if (Math.abs(sum - 1) > tolerance) throw new Error(`Raw behavior probability vector is not normalized: ${sum}`);
}

function validateModel(model: RecommendationBehavioralV8LinearModel): void {
  if (model.contract !== RECOMMENDATION_BEHAVIORAL_V8_CONTRACT) throw new Error('Behavioral V8 model contract mismatch');
  if (model.family !== 'CONDITIONAL_LINEAR') throw new Error('Behavioral V8 model family mismatch');
  if (model.probabilityContract !== RECOMMENDATION_BEHAVIORAL_V8_PROBABILITY_CONTRACT) throw new Error('Behavioral V8 probability contract mismatch');
  if (model.objective !== RECOMMENDATION_BEHAVIORAL_V8_OBJECTIVE) throw new Error('Behavioral V8 objective mismatch');
  if (model.weights.length !== model.hashDimension || model.biasByActionHash.length !== model.hashDimension) throw new Error('Behavioral V8 model shape mismatch');
  if (model.weights.some((value) => !Number.isFinite(value)) || model.biasByActionHash.some((value) => !Number.isFinite(value))) {
    throw new Error('Behavioral V8 model contains non-finite parameters');
  }
}

function validateDecision(decision: RecommendationBehavioralV8Decision): void {
  if (!decision.decisionId) throw new Error('decisionId is required');
  if (decision.candidates.length === 0) throw new Error('Behavioral decision must contain feasible candidates');
  const keys = new Set<string>();
  for (const candidate of decision.candidates) {
    if (!candidate.feasible) throw new Error(`Behavioral candidate ${candidate.actionKey} is not feasible`);
    if (keys.has(candidate.actionKey)) throw new Error(`Duplicate behavioral candidate ${candidate.actionKey}`);
    keys.add(candidate.actionKey);
  }
}

function validateTrainingOptions(options: RecommendationBehavioralV8TrainingOptions): void {
  if (!Number.isFinite(options.learningRate) || options.learningRate <= 0) throw new Error('learningRate must be positive');
  if (!Number.isFinite(options.l2) || options.l2 < 0) throw new Error('l2 must be non-negative');
  if (!Number.isFinite(options.gradientClip) || options.gradientClip <= 0) throw new Error('gradientClip must be positive');
}

function scoreCandidate(
  model: RecommendationBehavioralV8LinearModel,
  stateTokens: readonly string[],
  historyTokens: readonly string[],
  candidate: RecommendationBehavioralV8Candidate,
): number {
  return scoreCandidateFromIndices(model, candidate, candidateFeatureIndices(model, stateTokens, historyTokens, candidate));
}

function scoreCandidateFromIndices(
  model: RecommendationBehavioralV8LinearModel,
  candidate: RecommendationBehavioralV8Candidate,
  featureIndices: readonly number[],
): number {
  const biasIndex = hashToken(`BIAS:${candidate.actionKey}`, model.hashDimension);
  return featureIndices.reduce((sum, index) => sum + model.weights[index], model.biasByActionHash[biasIndex]);
}

function candidateFeatureIndices(
  model: RecommendationBehavioralV8LinearModel,
  stateTokens: readonly string[],
  historyTokens: readonly string[],
  candidate: RecommendationBehavioralV8Candidate,
): number[] {
  const actionTokens = recommendationActionTokensV8(candidate);
  const indices = new Set<number>();
  for (const token of stateTokens) indices.add(hashToken(`STATE:${token}`, model.hashDimension));
  for (const token of historyTokens) indices.add(hashToken(`HISTORY:${token}`, model.hashDimension));
  for (const token of actionTokens) indices.add(hashToken(`ACTION:${token}`, model.hashDimension));
  for (const stateToken of stateTokens) {
    for (const actionToken of actionTokens) {
      indices.add(hashToken(`CROSS:${stateToken}|${actionToken}`, model.hashDimension));
    }
  }
  const recentHistory = historyTokens.slice(Math.max(0, historyTokens.length - 16));
  for (const historyToken of recentHistory) {
    for (const actionToken of actionTokens) {
      indices.add(hashToken(`SEQ_CROSS:${historyToken}|${actionToken}`, model.hashDimension));
    }
  }
  return [...indices].sort((a, b) => a - b);
}

function stableSoftmax(scores: readonly number[]): number[] {
  const maxScore = Math.max(...scores);
  const exponentials = scores.map((score) => Math.exp(score - maxScore));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Behavioral V8 softmax normalization failed');
  return exponentials.map((value) => value / total);
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

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
