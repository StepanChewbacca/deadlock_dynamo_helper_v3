import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';

export const RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_SCHEMA_VERSION = 1;
export const RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_MODEL_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V6_LATENT_STATE_MIXTURE_1_RAW_PROPENSITY' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_FEATURE_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V6_LATENT_STATE_FEATURES_1_PREDECISION_HISTORY' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_PROBABILITY_CONTRACT =
  'RAW_MIXTURE_OF_WITHIN_DECISION_SOFTMAX_EXPERTS' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OBJECTIVE =
  'MIXTURE_NEGATIVE_LOG_LIKELIHOOD_1' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_GATE_CONTRACT =
  'PREDECISION_HASHED_SOFTMAX_GATE_1' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_EXPERT_CONTRACT =
  'INVERSE_RANK_BASE_PLUS_EXPERT_CANDIDATE_BIAS_1' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OPTIMIZER =
  'RESPONSIBILITY_WEIGHTED_AGGREGATED_SGD_1' as const;

export interface RecommendationBehavioralV6LatentMixtureConfig {
  expertCount: number;
  historyLength: number;
  gateHashDimension: number;
  candidateBiasHashDimension: number;
}

export interface RecommendationBehavioralV6LatentMixtureModel
  extends RecommendationBehavioralV6LatentMixtureConfig {
  schemaVersion: typeof RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_SCHEMA_VERSION;
  modelVersion: typeof RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_MODEL_VERSION;
  featureVersion: typeof RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_FEATURE_VERSION;
  probabilityContract: typeof RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_PROBABILITY_CONTRACT;
  objective: typeof RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OBJECTIVE;
  gateContract: typeof RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_GATE_CONTRACT;
  expertContract: typeof RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_EXPERT_CONTRACT;
  optimizerContract: typeof RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OPTIMIZER;
  gateWeights: number[];
  expertCandidateBiases: number[];
  trainedDecisionCount: number;
}

export interface RecommendationBehavioralV6LatentMixtureTrainingOptions {
  learningRate: number;
  l2: number;
  gradientClip: number;
}

export interface RecommendationBehavioralV6LatentMixtureCandidatePrediction {
  actionKey: string;
  itemId: number;
  probability: number;
  rank: number;
  expertProbabilities: number[];
}

export interface RecommendationBehavioralV6LatentMixturePrediction {
  candidates: RecommendationBehavioralV6LatentMixtureCandidatePrediction[];
  gateProbabilities: number[];
  observedActionKey: string;
  observedActionProbability: number;
  topActionKey: string;
  entropy: number;
}

export function createRecommendationBehavioralV6LatentMixtureModel(
  config: RecommendationBehavioralV6LatentMixtureConfig,
): RecommendationBehavioralV6LatentMixtureModel {
  validateConfig(config);
  return {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_PROBABILITY_CONTRACT,
    objective: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OBJECTIVE,
    gateContract: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_GATE_CONTRACT,
    expertContract: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_EXPERT_CONTRACT,
    optimizerContract: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OPTIMIZER,
    ...config,
    gateWeights: initializedArray(config.expertCount * config.gateHashDimension, 'GATE', 0.002),
    expertCandidateBiases: initializedArray(
      config.expertCount * config.candidateBiasHashDimension,
      'EXPERT_BIAS',
      0.005,
    ),
    trainedDecisionCount: 0,
  };
}

export function validateRecommendationBehavioralV6LatentMixtureModel(
  model: RecommendationBehavioralV6LatentMixtureModel,
): void {
  validateRecommendationBehavioralV6LatentMixtureModelHeader(model);
  validateFiniteArray(
    model.gateWeights,
    model.expertCount * model.gateHashDimension,
    'gateWeights',
  );
  validateFiniteArray(
    model.expertCandidateBiases,
    model.expertCount * model.candidateBiasHashDimension,
    'expertCandidateBiases',
  );
}

export function validateRecommendationBehavioralV6LatentMixtureModelHeader(
  model: RecommendationBehavioralV6LatentMixtureModel,
): void {
  if (
    model.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_SCHEMA_VERSION ||
    model.modelVersion !== RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_MODEL_VERSION ||
    model.featureVersion !== RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_FEATURE_VERSION ||
    model.probabilityContract !==
      RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_PROBABILITY_CONTRACT ||
    model.objective !== RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OBJECTIVE ||
    model.gateContract !== RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_GATE_CONTRACT ||
    model.expertContract !== RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_EXPERT_CONTRACT ||
    model.optimizerContract !== RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OPTIMIZER
  ) {
    throw new Error('Unsupported Recommendation Behavioral V6 latent-mixture model.');
  }
  validateConfig(model);
  if (
    model.gateWeights.length !== model.expertCount * model.gateHashDimension ||
    model.expertCandidateBiases.length !==
      model.expertCount * model.candidateBiasHashDimension ||
    !Number.isSafeInteger(model.trainedDecisionCount) ||
    model.trainedDecisionCount < 0
  ) {
    throw new Error('Behavioral V6 latent-mixture model shape/count is invalid.');
  }
}

export function recommendationBehavioralV6LatentMixtureGateTokens(
  model: RecommendationBehavioralV6LatentMixtureModel,
  row: RecommendationProDecisionDatasetV6Row,
): string[] {
  const history = row.state.previousActionKeys;
  const recent = history.slice(Math.max(0, history.length - model.historyLength));
  const tokens = [
    `HERO:${row.state.heroId}`,
    `PHASE:${row.state.phase}`,
    `TEAM:${row.state.team}`,
    `TIME10:${Math.floor(row.state.gameTimeS / 600)}`,
    `ECONOMY:${economyBand(row.state.netWorth)}`,
    `HISTORY_LENGTH:${historyLengthBand(history.length)}`,
    `INVENTORY_SIZE:${inventorySizeBand(row)}`,
    `HEALTH:${healthBand(row)}`,
  ];
  for (let index = 0; index < recent.length; index += 1) {
    const reversePosition = recent.length - 1 - index;
    tokens.push(`HISTORY_POS:${reversePosition}:${recent[index]}`);
  }
  if (recent.length >= 2) {
    tokens.push(`HISTORY_LAST2:${recent[recent.length - 2]}>${recent[recent.length - 1]}`);
  }
  if (recent.length >= 3) {
    tokens.push(
      `HISTORY_LAST3:${recent[recent.length - 3]}>${recent[recent.length - 2]}>${recent[recent.length - 1]}`,
    );
  }
  for (const [tag, count] of topInventoryTags(row)) {
    tokens.push(`INVENTORY_TAG:${tag}:${Math.min(3, count)}`);
  }
  return tokens;
}

export function predictRecommendationBehavioralV6LatentMixture(
  model: RecommendationBehavioralV6LatentMixtureModel,
  row: RecommendationProDecisionDatasetV6Row,
): RecommendationBehavioralV6LatentMixturePrediction {
  validateRecommendationBehavioralV6LatentMixtureModelHeader(model);
  validateRow(row);
  const gateTokens = recommendationBehavioralV6LatentMixtureGateTokens(model, row);
  const gateProbabilities = gateDistribution(model, gateTokens);
  const expertProbabilities = expertDistributions(model, row.candidates);
  const mixed = row.candidates.map((candidate, candidateIndex) => {
    let probability = 0;
    const perExpert = new Array(model.expertCount);
    for (let expert = 0; expert < model.expertCount; expert += 1) {
      const expertProbability = expertProbabilities[expert][candidateIndex];
      perExpert[expert] = expertProbability;
      probability += gateProbabilities[expert] * expertProbability;
    }
    return {
      actionKey: candidate.actionKey,
      itemId: candidate.itemId,
      probability,
      rank: 0,
      expertProbabilities: perExpert,
    };
  });
  const ranked = mixed
    .sort(
      (left, right) =>
        right.probability - left.probability || left.actionKey.localeCompare(right.actionKey),
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const observed = ranked.find((candidate) => candidate.actionKey === row.observedActionKey);
  return {
    candidates: ranked,
    gateProbabilities,
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
  };
}

export function trainRecommendationBehavioralV6LatentMixtureDecision(
  model: RecommendationBehavioralV6LatentMixtureModel,
  row: RecommendationProDecisionDatasetV6Row,
  options: RecommendationBehavioralV6LatentMixtureTrainingOptions,
): number {
  validateRecommendationBehavioralV6LatentMixtureModelHeader(model);
  validateTrainingOptions(options);
  validateRow(row);
  const observedIndex = row.candidates.findIndex(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  if (observedIndex < 0) {
    throw new Error('Behavioral V6 latent-mixture observed action is outside candidate set.');
  }

  const gateTokens = recommendationBehavioralV6LatentMixtureGateTokens(model, row);
  const tokenBuckets = uniqueBuckets(
    gateTokens.map((token) => fnv1a32(`GATE:${token}`) % model.gateHashDimension),
  );
  const gateProbabilities = gateDistributionFromBuckets(model, tokenBuckets);
  const expertProbabilities = expertDistributions(model, row.candidates);
  const observedMixture = gateProbabilities.reduce(
    (sum, gateProbability, expert) =>
      sum + gateProbability * expertProbabilities[expert][observedIndex],
    0,
  );
  const safeObservedMixture = Math.max(observedMixture, 1e-15);
  const responsibilities = gateProbabilities.map(
    (gateProbability, expert) =>
      (gateProbability * expertProbabilities[expert][observedIndex]) /
      safeObservedMixture,
  );

  for (let expert = 0; expert < model.expertCount; expert += 1) {
    const gateError = responsibilities[expert] - gateProbabilities[expert];
    for (const bucket of tokenBuckets) {
      const parameterIndex = expert * model.gateHashDimension + bucket;
      const value = model.gateWeights[parameterIndex];
      const gradient = gateError - options.l2 * value;
      model.gateWeights[parameterIndex] +=
        options.learningRate * clip(gradient, options.gradientClip);
    }

    const biasGradients = new Map<number, number>();
    for (let candidateIndex = 0; candidateIndex < row.candidates.length; candidateIndex += 1) {
      const candidate = row.candidates[candidateIndex];
      const bucket = candidateBiasBucket(model, candidate);
      const error =
        responsibilities[expert] *
        ((candidateIndex === observedIndex ? 1 : 0) -
          expertProbabilities[expert][candidateIndex]);
      biasGradients.set(bucket, (biasGradients.get(bucket) ?? 0) + error);
    }
    for (const [bucket, dataGradient] of biasGradients.entries()) {
      const parameterIndex = expert * model.candidateBiasHashDimension + bucket;
      const value = model.expertCandidateBiases[parameterIndex];
      const gradient = dataGradient - options.l2 * value;
      model.expertCandidateBiases[parameterIndex] +=
        options.learningRate * clip(gradient, options.gradientClip);
    }
  }

  model.trainedDecisionCount += 1;
  return -Math.log(safeObservedMixture);
}

function gateDistribution(
  model: RecommendationBehavioralV6LatentMixtureModel,
  tokens: readonly string[],
): number[] {
  const buckets = uniqueBuckets(
    tokens.map((token) => fnv1a32(`GATE:${token}`) % model.gateHashDimension),
  );
  return gateDistributionFromBuckets(model, buckets);
}

function gateDistributionFromBuckets(
  model: RecommendationBehavioralV6LatentMixtureModel,
  buckets: readonly number[],
): number[] {
  const normalization = Math.sqrt(Math.max(1, buckets.length));
  const logits = new Array(model.expertCount).fill(0);
  for (let expert = 0; expert < model.expertCount; expert += 1) {
    let logit = 0;
    const offset = expert * model.gateHashDimension;
    for (const bucket of buckets) {
      logit += model.gateWeights[offset + bucket];
    }
    logits[expert] = logit / normalization;
  }
  return softmax(logits);
}

function expertDistributions(
  model: RecommendationBehavioralV6LatentMixtureModel,
  candidates: readonly RecommendationDatasetV6CandidateFeatures[],
): number[][] {
  const result = new Array(model.expertCount);
  for (let expert = 0; expert < model.expertCount; expert += 1) {
    const offset = expert * model.candidateBiasHashDimension;
    const scores = candidates.map((candidate) =>
      -Math.log(Math.max(1, candidate.rank)) +
      model.expertCandidateBiases[offset + candidateBiasBucket(model, candidate)],
    );
    result[expert] = softmax(scores);
  }
  return result;
}

function validateConfig(config: RecommendationBehavioralV6LatentMixtureConfig): void {
  if (!Number.isSafeInteger(config.expertCount) || config.expertCount < 2 || config.expertCount > 8) {
    throw new Error('Behavioral V6 latent-mixture expertCount must be between 2 and 8.');
  }
  if (!Number.isSafeInteger(config.historyLength) || config.historyLength < 2 || config.historyLength > 32) {
    throw new Error('Behavioral V6 latent-mixture historyLength must be between 2 and 32.');
  }
  for (const [name, value] of [
    ['gateHashDimension', config.gateHashDimension],
    ['candidateBiasHashDimension', config.candidateBiasHashDimension],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 128 || value > 262_144) {
      throw new Error(`Behavioral V6 latent-mixture ${name} must be between 128 and 262144.`);
    }
  }
}

function validateTrainingOptions(
  options: RecommendationBehavioralV6LatentMixtureTrainingOptions,
): void {
  if (!Number.isFinite(options.learningRate) || options.learningRate <= 0 || options.learningRate > 1) {
    throw new Error('Behavioral V6 latent-mixture learningRate must be in (0, 1].');
  }
  if (!Number.isFinite(options.l2) || options.l2 < 0 || options.l2 > 1) {
    throw new Error('Behavioral V6 latent-mixture l2 must be in [0, 1].');
  }
  if (!Number.isFinite(options.gradientClip) || options.gradientClip <= 0 || options.gradientClip > 100) {
    throw new Error('Behavioral V6 latent-mixture gradientClip must be in (0, 100].');
  }
}

function validateRow(row: RecommendationProDecisionDatasetV6Row): void {
  if (!row.decisionId.trim() || !row.matchId.trim() || row.candidates.length < 2) {
    throw new Error('Behavioral V6 latent-mixture row identity/candidates are invalid.');
  }
  const keys = new Set<string>();
  for (const candidate of row.candidates) {
    if (!candidate.actionKey.trim() || keys.has(candidate.actionKey)) {
      throw new Error('Behavioral V6 latent-mixture candidate action keys must be unique.');
    }
    keys.add(candidate.actionKey);
  }
}

function initializedArray(length: number, namespace: string, scale: number): number[] {
  return Array.from({ length }, (_, index) => deterministicInitialValue(`${namespace}:${index}`, scale));
}

function deterministicInitialValue(key: string, scale: number): number {
  const hash = fnv1a32(key);
  return (((hash & 0xffff) / 0xffff) * 2 - 1) * scale;
}

function validateFiniteArray(values: number[], length: number, name: string): void {
  if (values.length !== length || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Behavioral V6 latent-mixture ${name} is invalid.`);
  }
}

function candidateBiasBucket(
  model: RecommendationBehavioralV6LatentMixtureModel,
  candidate: RecommendationDatasetV6CandidateFeatures,
): number {
  return (
    fnv1a32(`CANDIDATE:${candidate.actionKey}:${candidate.itemId}`) %
    model.candidateBiasHashDimension
  );
}

function uniqueBuckets(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function topInventoryTags(
  row: RecommendationProDecisionDatasetV6Row,
): Array<[string, number]> {
  return Object.entries(row.state.inventoryTagCounts ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([tag, count]) => [tag, Number(count)] as [string, number])
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4);
}

function historyLengthBand(length: number): string {
  if (length <= 3) return 'LE3';
  if (length <= 6) return '4_6';
  if (length <= 9) return '7_9';
  if (length <= 12) return '10_12';
  return 'GE13';
}

function inventorySizeBand(row: RecommendationProDecisionDatasetV6Row): string {
  const size = row.state.inventoryItemCounts.reduce((sum, entry) => sum + entry.count, 0);
  if (size <= 3) return 'LE3';
  if (size <= 6) return '4_6';
  if (size <= 9) return '7_9';
  return 'GE10';
}

function economyBand(netWorth: number | undefined): string {
  const value = finite(netWorth);
  if (value < 5_000) return 'LT5000';
  if (value < 10_000) return '5000_9999';
  if (value < 15_000) return '10000_14999';
  if (value < 20_000) return '15000_19999';
  return 'GE_20000';
}

function healthBand(row: RecommendationProDecisionDatasetV6Row): string {
  const maximum = finite(row.state.maxHealth);
  const ratio = maximum > 0 ? finite(row.state.health) / maximum : 0;
  if (ratio < 0.25) return 'LT025';
  if (ratio < 0.5) return '025_049';
  if (ratio < 0.75) return '050_074';
  return 'GE075';
}

function finite(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
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
    throw new Error('Behavioral V6 latent-mixture softmax normalization failed.');
  }
  return weights.map((value) => value / total);
}

function clip(value: number, maximumAbsoluteValue: number): number {
  return Math.max(-maximumAbsoluteValue, Math.min(maximumAbsoluteValue, value));
}
