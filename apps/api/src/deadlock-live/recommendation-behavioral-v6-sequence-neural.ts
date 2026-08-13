import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';

export const RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_SCHEMA_VERSION = 1;
export const RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_MODEL_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_NEURAL_1_RAW_PROPENSITY' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_FEATURE_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_FEATURES_1_ORDERED_HISTORY' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_PROBABILITY_CONTRACT =
  'RAW_SOFTMAX_WITHIN_DECISION' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OBJECTIVE =
  'GROUPED_LISTWISE_SOFTMAX_CROSS_ENTROPY_1' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_BASE_SCORE =
  'NEGATIVE_LOG_CANDIDATE_RANK_1' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_ENCODER =
  'RECURRENT_TANH_ORDERED_ACTION_ENCODER_1' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OPTIMIZER =
  'ONLINE_SGD_DECISION_GROUP_1' as const;

export interface RecommendationBehavioralV6SequenceConfig {
  historyLength: number;
  hiddenDimension: number;
  sequenceEmbeddingHashDimension: number;
  contextEmbeddingHashDimension: number;
  candidateEmbeddingHashDimension: number;
  candidateBiasHashDimension: number;
  recurrenceDecay: number;
}

export interface RecommendationBehavioralV6SequenceModel
  extends RecommendationBehavioralV6SequenceConfig {
  schemaVersion: typeof RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_SCHEMA_VERSION;
  modelVersion: typeof RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_MODEL_VERSION;
  featureVersion: typeof RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_FEATURE_VERSION;
  probabilityContract: typeof RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_PROBABILITY_CONTRACT;
  objective: typeof RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OBJECTIVE;
  baseScoreContract: typeof RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_BASE_SCORE;
  encoderContract: typeof RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_ENCODER;
  optimizerContract: typeof RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OPTIMIZER;
  sequenceEmbeddings: number[];
  positionEmbeddings: number[];
  contextEmbeddings: number[];
  candidateEmbeddings: number[];
  candidateBiases: number[];
  trainedDecisionCount: number;
}

export interface RecommendationBehavioralV6SequenceTrainingOptions {
  learningRate: number;
  l2: number;
  gradientClip: number;
}

export interface RecommendationBehavioralV6SequenceCandidatePrediction {
  actionKey: string;
  itemId: number;
  baseScore: number;
  sequenceResidual: number;
  candidateBias: number;
  score: number;
  probability: number;
  rank: number;
}

export interface RecommendationBehavioralV6SequencePrediction {
  candidates: RecommendationBehavioralV6SequenceCandidatePrediction[];
  observedActionKey: string;
  observedActionProbability: number;
  topActionKey: string;
  entropy: number;
  encodedHistoryLength: number;
}

interface SequenceForwardPass {
  hiddenStates: number[][];
  preActivationStates: number[][];
  contextTokens: string[];
  sequenceTokens: string[];
  finalHidden: number[];
}

export function createRecommendationBehavioralV6SequenceModel(
  config: RecommendationBehavioralV6SequenceConfig,
): RecommendationBehavioralV6SequenceModel {
  validateConfig(config);
  const hidden = config.hiddenDimension;
  return {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_PROBABILITY_CONTRACT,
    objective: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OBJECTIVE,
    baseScoreContract: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_BASE_SCORE,
    encoderContract: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_ENCODER,
    optimizerContract: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OPTIMIZER,
    ...config,
    sequenceEmbeddings: initializedArray(
      config.sequenceEmbeddingHashDimension * hidden,
      'SEQ',
    ),
    positionEmbeddings: initializedArray(config.historyLength * hidden, 'POS'),
    contextEmbeddings: initializedArray(
      config.contextEmbeddingHashDimension * hidden,
      'CTX',
    ),
    candidateEmbeddings: initializedArray(
      config.candidateEmbeddingHashDimension * hidden,
      'CAND',
    ),
    candidateBiases: initializedArray(config.candidateBiasHashDimension, 'BIAS'),
    trainedDecisionCount: 0,
  };
}

export function validateRecommendationBehavioralV6SequenceModel(
  model: RecommendationBehavioralV6SequenceModel,
): void {
  validateRecommendationBehavioralV6SequenceModelHeader(model);
  const hidden = model.hiddenDimension;
  validateFiniteArray(
    model.sequenceEmbeddings,
    model.sequenceEmbeddingHashDimension * hidden,
    'sequenceEmbeddings',
  );
  validateFiniteArray(
    model.positionEmbeddings,
    model.historyLength * hidden,
    'positionEmbeddings',
  );
  validateFiniteArray(
    model.contextEmbeddings,
    model.contextEmbeddingHashDimension * hidden,
    'contextEmbeddings',
  );
  validateFiniteArray(
    model.candidateEmbeddings,
    model.candidateEmbeddingHashDimension * hidden,
    'candidateEmbeddings',
  );
  validateFiniteArray(
    model.candidateBiases,
    model.candidateBiasHashDimension,
    'candidateBiases',
  );
}

export function validateRecommendationBehavioralV6SequenceModelHeader(
  model: RecommendationBehavioralV6SequenceModel,
): void {
  if (
    model.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_SCHEMA_VERSION ||
    model.modelVersion !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_MODEL_VERSION ||
    model.featureVersion !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_FEATURE_VERSION ||
    model.probabilityContract !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_PROBABILITY_CONTRACT ||
    model.objective !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OBJECTIVE ||
    model.baseScoreContract !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_BASE_SCORE ||
    model.encoderContract !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_ENCODER ||
    model.optimizerContract !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OPTIMIZER
  ) {
    throw new Error('Unsupported Recommendation Behavioral V6 sequence model.');
  }
  validateConfig(model);
  if (
    !Number.isSafeInteger(model.trainedDecisionCount) ||
    model.trainedDecisionCount < 0
  ) {
    throw new Error('Behavioral V6 sequence trainedDecisionCount is invalid.');
  }
  const hidden = model.hiddenDimension;
  if (
    model.sequenceEmbeddings.length !== model.sequenceEmbeddingHashDimension * hidden ||
    model.positionEmbeddings.length !== model.historyLength * hidden ||
    model.contextEmbeddings.length !== model.contextEmbeddingHashDimension * hidden ||
    model.candidateEmbeddings.length !== model.candidateEmbeddingHashDimension * hidden ||
    model.candidateBiases.length !== model.candidateBiasHashDimension
  ) {
    throw new Error('Behavioral V6 sequence model array shape mismatch.');
  }
}

export function recommendationBehavioralV6SequenceContextTokens(
  row: RecommendationProDecisionDatasetV6Row,
): string[] {
  const tokens = [
    `HERO:${row.state.heroId}`,
    `TEAM:${row.state.team}`,
    `PHASE:${row.state.phase}`,
    `TIME:${Math.floor(row.state.gameTimeS / 300)}`,
    `ECONOMY:${economyBand(row.state.netWorth)}`,
    `LEVEL:${Math.floor(finite(row.state.level) / 3)}`,
    `HEALTH:${healthBand(row)}`,
    `INVENTORY_SIZE:${inventorySizeBand(row)}`,
  ];
  for (const entry of row.state.inventoryItemCounts.slice(0, 12)) {
    tokens.push(`OWNED:${entry.itemId}:${Math.min(3, entry.count)}`);
  }
  return tokens;
}

export function recommendationBehavioralV6SequenceHistoryTokens(
  model: RecommendationBehavioralV6SequenceModel,
  row: RecommendationProDecisionDatasetV6Row,
): string[] {
  const history = row.state.previousActionKeys;
  const start = Math.max(0, history.length - model.historyLength);
  return history.slice(start);
}

export function recommendationBehavioralV6SequenceBaseScore(rank: number): number {
  if (!Number.isFinite(rank) || rank < 1) {
    throw new Error('Behavioral V6 sequence candidate rank must be >= 1.');
  }
  return -Math.log(rank);
}

export function predictRecommendationBehavioralV6Sequence(
  model: RecommendationBehavioralV6SequenceModel,
  row: RecommendationProDecisionDatasetV6Row,
): RecommendationBehavioralV6SequencePrediction {
  validateRecommendationBehavioralV6SequenceModelHeader(model);
  validateRow(row);
  const forward = forwardSequence(model, row);
  const scored = row.candidates.map((candidate) =>
    scoreCandidate(model, candidate, forward.finalHidden),
  );
  const probabilities = softmax(scored.map((value) => value.score));
  const ranked = scored
    .map((value, index) => ({ ...value, probability: probabilities[index], rank: 0 }))
    .sort(
      (left, right) =>
        right.probability - left.probability || left.actionKey.localeCompare(right.actionKey),
    )
    .map((value, index) => ({ ...value, rank: index + 1 }));
  const observed = ranked.find((candidate) => candidate.actionKey === row.observedActionKey);
  return {
    candidates: ranked,
    observedActionKey: row.observedActionKey,
    observedActionProbability: observed?.probability ?? 0,
    topActionKey: ranked[0].actionKey,
    entropy: -ranked.reduce(
      (sum, candidate) =>
        sum +
        (candidate.probability <= 0
          ? 0
          : candidate.probability * Math.log(candidate.probability)),
      0,
    ),
    encodedHistoryLength: forward.sequenceTokens.length,
  };
}

export function trainRecommendationBehavioralV6SequenceDecision(
  model: RecommendationBehavioralV6SequenceModel,
  row: RecommendationProDecisionDatasetV6Row,
  options: RecommendationBehavioralV6SequenceTrainingOptions,
): number {
  validateRecommendationBehavioralV6SequenceModelHeader(model);
  validateTrainingOptions(options);
  validateRow(row);
  const observedIndex = row.candidates.findIndex(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  if (observedIndex < 0) {
    throw new Error('Behavioral V6 sequence observed action is outside candidate set.');
  }

  const forward = forwardSequence(model, row);
  const scored = row.candidates.map((candidate) =>
    scoreCandidate(model, candidate, forward.finalHidden),
  );
  const probabilities = softmax(scored.map((value) => value.score));
  const errors = probabilities.map((probability, index) =>
    (index === observedIndex ? 1 : 0) - probability,
  );
  const hiddenGradient = new Array(model.hiddenDimension).fill(0);

  for (let index = 0; index < row.candidates.length; index += 1) {
    const candidate = row.candidates[index];
    const error = errors[index];
    const embeddingBucket = candidateEmbeddingBucket(model, candidate);
    const embeddingOffset = embeddingBucket * model.hiddenDimension;
    for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
      const candidateValue = model.candidateEmbeddings[embeddingOffset + dimension];
      hiddenGradient[dimension] += error * candidateValue;
      const gradient = error * forward.finalHidden[dimension] - options.l2 * candidateValue;
      model.candidateEmbeddings[embeddingOffset + dimension] +=
        options.learningRate * clip(gradient, options.gradientClip);
    }
    const biasIndex = candidateBiasBucket(model, candidate);
    const bias = model.candidateBiases[biasIndex];
    model.candidateBiases[biasIndex] +=
      options.learningRate * clip(error - options.l2 * bias, options.gradientClip);
  }

  backpropagateSequence(model, forward, hiddenGradient, options);
  model.trainedDecisionCount += 1;
  return -Math.log(Math.max(probabilities[observedIndex], 1e-15));
}

function forwardSequence(
  model: RecommendationBehavioralV6SequenceModel,
  row: RecommendationProDecisionDatasetV6Row,
): SequenceForwardPass {
  const contextTokens = recommendationBehavioralV6SequenceContextTokens(row);
  const sequenceTokens = recommendationBehavioralV6SequenceHistoryTokens(model, row);
  const hidden = new Array(model.hiddenDimension).fill(0);
  for (const token of contextTokens) {
    const offset = contextBucket(model, token) * model.hiddenDimension;
    for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
      hidden[dimension] += model.contextEmbeddings[offset + dimension] / contextTokens.length;
    }
  }
  for (let dimension = 0; dimension < hidden.length; dimension += 1) {
    hidden[dimension] = Math.tanh(hidden[dimension]);
  }

  const hiddenStates: number[][] = [hidden.slice()];
  const preActivationStates: number[][] = [];
  for (let index = 0; index < sequenceTokens.length; index += 1) {
    const token = sequenceTokens[index];
    const sequenceOffset = sequenceBucket(model, token) * model.hiddenDimension;
    const position = model.historyLength - sequenceTokens.length + index;
    const positionOffset = position * model.hiddenDimension;
    const previous = hiddenStates[hiddenStates.length - 1];
    const preActivation = new Array(model.hiddenDimension);
    const next = new Array(model.hiddenDimension);
    for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
      const value =
        model.recurrenceDecay * previous[dimension] +
        model.sequenceEmbeddings[sequenceOffset + dimension] +
        model.positionEmbeddings[positionOffset + dimension];
      preActivation[dimension] = value;
      next[dimension] = Math.tanh(value);
    }
    preActivationStates.push(preActivation);
    hiddenStates.push(next);
  }

  return {
    hiddenStates,
    preActivationStates,
    contextTokens,
    sequenceTokens,
    finalHidden: hiddenStates[hiddenStates.length - 1],
  };
}

function scoreCandidate(
  model: RecommendationBehavioralV6SequenceModel,
  candidate: RecommendationDatasetV6CandidateFeatures,
  hidden: readonly number[],
): Omit<RecommendationBehavioralV6SequenceCandidatePrediction, 'probability' | 'rank'> {
  const embeddingOffset = candidateEmbeddingBucket(model, candidate) * model.hiddenDimension;
  let dot = 0;
  for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
    dot += hidden[dimension] * model.candidateEmbeddings[embeddingOffset + dimension];
  }
  const sequenceResidual = dot / Math.sqrt(model.hiddenDimension);
  const candidateBias = model.candidateBiases[candidateBiasBucket(model, candidate)];
  const baseScore = recommendationBehavioralV6SequenceBaseScore(candidate.rank);
  return {
    actionKey: candidate.actionKey,
    itemId: candidate.itemId,
    baseScore,
    sequenceResidual,
    candidateBias,
    score: baseScore + sequenceResidual + candidateBias,
  };
}

function backpropagateSequence(
  model: RecommendationBehavioralV6SequenceModel,
  forward: SequenceForwardPass,
  finalHiddenGradient: number[],
  options: RecommendationBehavioralV6SequenceTrainingOptions,
): void {
  let hiddenGradient = finalHiddenGradient.map((value) =>
    value / Math.sqrt(model.hiddenDimension),
  );
  for (let index = forward.sequenceTokens.length - 1; index >= 0; index -= 1) {
    const currentHidden = forward.hiddenStates[index + 1];
    const token = forward.sequenceTokens[index];
    const sequenceOffset = sequenceBucket(model, token) * model.hiddenDimension;
    const position = model.historyLength - forward.sequenceTokens.length + index;
    const positionOffset = position * model.hiddenDimension;
    const previousGradient = new Array(model.hiddenDimension).fill(0);
    for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
      const localGradient = hiddenGradient[dimension] * (1 - currentHidden[dimension] ** 2);
      const sequenceValue = model.sequenceEmbeddings[sequenceOffset + dimension];
      const positionValue = model.positionEmbeddings[positionOffset + dimension];
      model.sequenceEmbeddings[sequenceOffset + dimension] +=
        options.learningRate * clip(
          localGradient - options.l2 * sequenceValue,
          options.gradientClip,
        );
      model.positionEmbeddings[positionOffset + dimension] +=
        options.learningRate * clip(
          localGradient - options.l2 * positionValue,
          options.gradientClip,
        );
      previousGradient[dimension] = model.recurrenceDecay * localGradient;
    }
    hiddenGradient = previousGradient;
  }

  const initialHidden = forward.hiddenStates[0];
  const contextScale = Math.max(1, forward.contextTokens.length);
  for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
    hiddenGradient[dimension] *= 1 - initialHidden[dimension] ** 2;
  }
  for (const token of forward.contextTokens) {
    const offset = contextBucket(model, token) * model.hiddenDimension;
    for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
      const value = model.contextEmbeddings[offset + dimension];
      const gradient = hiddenGradient[dimension] / contextScale - options.l2 * value;
      model.contextEmbeddings[offset + dimension] +=
        options.learningRate * clip(gradient, options.gradientClip);
    }
  }
}

function validateConfig(config: RecommendationBehavioralV6SequenceConfig): void {
  if (!Number.isSafeInteger(config.historyLength) || config.historyLength < 2 || config.historyLength > 64) {
    throw new Error('Behavioral V6 sequence historyLength must be between 2 and 64.');
  }
  if (!Number.isSafeInteger(config.hiddenDimension) || config.hiddenDimension < 2 || config.hiddenDimension > 64) {
    throw new Error('Behavioral V6 sequence hiddenDimension must be between 2 and 64.');
  }
  for (const [name, value] of [
    ['sequenceEmbeddingHashDimension', config.sequenceEmbeddingHashDimension],
    ['contextEmbeddingHashDimension', config.contextEmbeddingHashDimension],
    ['candidateEmbeddingHashDimension', config.candidateEmbeddingHashDimension],
    ['candidateBiasHashDimension', config.candidateBiasHashDimension],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 128 || value > 262_144) {
      throw new Error(`Behavioral V6 sequence ${name} must be between 128 and 262144.`);
    }
  }
  if (!Number.isFinite(config.recurrenceDecay) || config.recurrenceDecay <= 0 || config.recurrenceDecay > 1) {
    throw new Error('Behavioral V6 sequence recurrenceDecay must be in (0, 1].');
  }
}

function validateTrainingOptions(options: RecommendationBehavioralV6SequenceTrainingOptions): void {
  if (!Number.isFinite(options.learningRate) || options.learningRate <= 0 || options.learningRate > 1) {
    throw new Error('Behavioral V6 sequence learningRate must be in (0, 1].');
  }
  if (!Number.isFinite(options.l2) || options.l2 < 0 || options.l2 > 1) {
    throw new Error('Behavioral V6 sequence l2 must be in [0, 1].');
  }
  if (!Number.isFinite(options.gradientClip) || options.gradientClip <= 0 || options.gradientClip > 100) {
    throw new Error('Behavioral V6 sequence gradientClip must be in (0, 100].');
  }
}

function validateRow(row: RecommendationProDecisionDatasetV6Row): void {
  if (!row.decisionId.trim() || !row.matchId.trim() || row.candidates.length < 2) {
    throw new Error('Behavioral V6 sequence row identity/candidates are invalid.');
  }
  const keys = new Set<string>();
  for (const candidate of row.candidates) {
    if (!candidate.actionKey.trim() || keys.has(candidate.actionKey)) {
      throw new Error('Behavioral V6 sequence candidate action keys must be unique.');
    }
    keys.add(candidate.actionKey);
  }
}

function validateFiniteArray(values: number[], length: number, name: string): void {
  if (values.length !== length || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Behavioral V6 sequence ${name} is invalid.`);
  }
}

function initializedArray(length: number, namespace: string): number[] {
  return Array.from({ length }, (_, index) => deterministicInitialValue(`${namespace}:${index}`));
}

function deterministicInitialValue(key: string): number {
  const hash = fnv1a32(key);
  return (((hash & 0xffff) / 0xffff) * 2 - 1) * 0.01;
}

function sequenceBucket(model: RecommendationBehavioralV6SequenceModel, token: string): number {
  return fnv1a32(`SEQ:${token}`) % model.sequenceEmbeddingHashDimension;
}

function contextBucket(model: RecommendationBehavioralV6SequenceModel, token: string): number {
  return fnv1a32(`CTX:${token}`) % model.contextEmbeddingHashDimension;
}

function candidateEmbeddingBucket(
  model: RecommendationBehavioralV6SequenceModel,
  candidate: RecommendationDatasetV6CandidateFeatures,
): number {
  return fnv1a32(`CAND:${candidate.actionKey}:${candidate.itemId}`) % model.candidateEmbeddingHashDimension;
}

function candidateBiasBucket(
  model: RecommendationBehavioralV6SequenceModel,
  candidate: RecommendationDatasetV6CandidateFeatures,
): number {
  return fnv1a32(`BIAS:${candidate.actionKey}:${candidate.itemId}`) % model.candidateBiasHashDimension;
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function softmax(scores: readonly number[]): number[] {
  const maximum = Math.max(...scores);
  const weights = scores.map((score) => Math.exp(score - maximum));
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Behavioral V6 sequence softmax normalization failed.');
  }
  return weights.map((value) => value / total);
}

function economyBand(netWorth: number | undefined): string {
  const value = finite(netWorth);
  if (value < 5_000) return 'LT_5000';
  if (value < 10_000) return '5000_9999';
  if (value < 15_000) return '10000_14999';
  if (value < 20_000) return '15000_19999';
  return 'GE_20000';
}

function healthBand(row: RecommendationProDecisionDatasetV6Row): string {
  const maximum = finite(row.state.maxHealth);
  const ratio = maximum > 0 ? finite(row.state.health) / maximum : 0;
  if (ratio < 0.25) return 'LT_025';
  if (ratio < 0.5) return '025_049';
  if (ratio < 0.75) return '050_074';
  return 'GE_075';
}

function inventorySizeBand(row: RecommendationProDecisionDatasetV6Row): string {
  const count = row.state.inventoryItemCounts.reduce((sum, entry) => sum + entry.count, 0);
  if (count <= 3) return 'LE_3';
  if (count <= 6) return '4_6';
  if (count <= 9) return '7_9';
  return 'GE_10';
}

function finite(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function clip(value: number, maximumAbsoluteValue: number): number {
  return Math.max(-maximumAbsoluteValue, Math.min(maximumAbsoluteValue, value));
}
