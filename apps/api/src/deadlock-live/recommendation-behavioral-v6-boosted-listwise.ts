import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';

export const RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_SCHEMA_VERSION = 1;
export const RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_MODEL_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V6_GROUPED_BOOSTED_LISTWISE_1_RAW_PROPENSITY' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_FEATURE_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_FEATURES_1' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_PROBABILITY_CONTRACT =
  'RAW_SOFTMAX_WITHIN_DECISION' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_OBJECTIVE =
  'GROUPED_LISTWISE_SOFTMAX_CROSS_ENTROPY_1' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_BASE_SCORE =
  'NEGATIVE_LOG_CANDIDATE_RANK_1' as const;
export const RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_TREE_CONTRACT =
  'NEWTON_BOOSTED_STUMPS_FIXED_SPLIT_GRID_1' as const;

export const RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_NUMERIC_FEATURES = [
  'RANK',
  'INVERSE_RANK',
  'HISTORICAL_PROBABILITY',
  'GENERATOR_SCORE',
  'CONFIDENCE',
  'LOG_COST',
  'COST_TO_NETWORTH_RATIO',
  'MISSING_COMPONENT_COUNT',
  'PREVIOUS_ACTION_COUNT',
  'INVENTORY_TAG_OVERLAP_COUNT',
  'GAME_TIME_MINUTES',
  'LOG_NETWORTH',
  'TIER',
  'INVENTORY_SIZE',
  'HEALTH_RATIO',
] as const;

export const RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_CATEGORICAL_FEATURES = [
  'ITEM',
  'ACTION',
  'HERO_ITEM',
  'PHASE_ITEM',
  'TIME_ITEM',
  'ECONOMY_ITEM',
  'HERO_SLOT',
  'ACTION_TYPE',
  'SLOT_TYPE',
  'LAST_ACTION_ITEM',
] as const;

export const RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_NUMERIC_THRESHOLDS: readonly (readonly number[])[] = [
  [1.5, 3.5, 7.5, 15.5, 31.5, 63.5],
  [1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2],
  [0.0025, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25],
  [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  [0.1, 0.25, 0.5, 0.75, 0.9],
  [6, 7, 8, 9, 10],
  [0.05, 0.1, 0.2, 0.4, 0.75, 1.25],
  [0.5, 1.5, 2.5, 3.5],
  [0.5, 1.5, 2.5, 3.5],
  [0.5, 1.5, 3.5, 7.5],
  [5, 10, 15, 20, 25, 30, 40],
  [7, 8, 9, 10, 11],
  [0.5, 1.5, 2.5, 3.5],
  [2.5, 5.5, 8.5, 11.5, 14.5],
  [0.25, 0.5, 0.75, 0.9],
] as const;

export type RecommendationBehavioralV6BoostedNumericFeatureName =
  (typeof RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_NUMERIC_FEATURES)[number];
export type RecommendationBehavioralV6BoostedCategoricalFeatureName =
  (typeof RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_CATEGORICAL_FEATURES)[number];

export interface RecommendationBehavioralV6BoostedFeatureVector {
  numeric: number[];
  categorical: number[];
}

export interface RecommendationBehavioralV6BoostedNumericSplit {
  kind: 'NUMERIC_LE';
  featureIndex: number;
  threshold: number;
}

export interface RecommendationBehavioralV6BoostedCategoricalSplit {
  kind: 'CATEGORICAL_EQ';
  featureIndex: number;
  categoryHash: number;
}

export type RecommendationBehavioralV6BoostedSplit =
  | RecommendationBehavioralV6BoostedNumericSplit
  | RecommendationBehavioralV6BoostedCategoricalSplit;

export interface RecommendationBehavioralV6BoostedStump {
  split: RecommendationBehavioralV6BoostedSplit;
  leftValue: number;
  rightValue: number;
  gain: number;
  leftCandidateCount: number;
  rightCandidateCount: number;
  round: number;
}

export interface RecommendationBehavioralV6BoostedModel {
  schemaVersion: typeof RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_SCHEMA_VERSION;
  modelVersion: typeof RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_MODEL_VERSION;
  featureVersion: typeof RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_FEATURE_VERSION;
  probabilityContract: typeof RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_PROBABILITY_CONTRACT;
  objective: typeof RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_OBJECTIVE;
  baseScoreContract: typeof RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_BASE_SCORE;
  treeContract: typeof RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_TREE_CONTRACT;
  learningRate: number;
  leafL2: number;
  maximumLeafValue: number;
  minimumLeafCandidateCount: number;
  trees: RecommendationBehavioralV6BoostedStump[];
  trainedDecisionCount: number;
}

export interface RecommendationBehavioralV6BoostedModelConfig {
  learningRate: number;
  leafL2: number;
  maximumLeafValue: number;
  minimumLeafCandidateCount: number;
}

export interface RecommendationBehavioralV6BoostedCandidatePrediction {
  actionKey: string;
  itemId: number;
  baseScore: number;
  boostedScore: number;
  score: number;
  probability: number;
  rank: number;
}

export interface RecommendationBehavioralV6BoostedPrediction {
  candidates: RecommendationBehavioralV6BoostedCandidatePrediction[];
  observedActionKey: string;
  observedActionProbability: number;
  topActionKey: string;
  entropy: number;
}

export function createRecommendationBehavioralV6BoostedModel(
  config: RecommendationBehavioralV6BoostedModelConfig,
): RecommendationBehavioralV6BoostedModel {
  validateConfig(config);
  return {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_PROBABILITY_CONTRACT,
    objective: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_OBJECTIVE,
    baseScoreContract: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_BASE_SCORE,
    treeContract: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_TREE_CONTRACT,
    learningRate: config.learningRate,
    leafL2: config.leafL2,
    maximumLeafValue: config.maximumLeafValue,
    minimumLeafCandidateCount: config.minimumLeafCandidateCount,
    trees: [],
    trainedDecisionCount: 0,
  };
}

export function validateRecommendationBehavioralV6BoostedModel(
  model: RecommendationBehavioralV6BoostedModel,
): void {
  if (
    model.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_SCHEMA_VERSION ||
    model.modelVersion !== RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_MODEL_VERSION ||
    model.featureVersion !== RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_FEATURE_VERSION ||
    model.probabilityContract !== RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_PROBABILITY_CONTRACT ||
    model.objective !== RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_OBJECTIVE ||
    model.baseScoreContract !== RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_BASE_SCORE ||
    model.treeContract !== RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_TREE_CONTRACT
  ) {
    throw new Error('Unsupported Recommendation Behavioral V6 boosted model.');
  }
  validateConfig(model);
  if (!Number.isSafeInteger(model.trainedDecisionCount) || model.trainedDecisionCount < 0) {
    throw new Error('Behavioral V6 boosted trainedDecisionCount is invalid.');
  }
  for (let index = 0; index < model.trees.length; index += 1) {
    validateStump(model.trees[index], index + 1);
  }
}

export function recommendationBehavioralV6BoostedFeatureVector(
  row: RecommendationProDecisionDatasetV6Row,
  candidate: RecommendationDatasetV6CandidateFeatures,
): RecommendationBehavioralV6BoostedFeatureVector {
  const lastAction = row.state.previousActionKeys.at(-1) ?? 'NONE';
  const timeBucket = Math.floor(row.state.gameTimeS / 300);
  const economy = economyBand(row.state.netWorth);
  const inventorySize = row.state.inventoryItemCounts.reduce(
    (sum, value) => sum + value.count,
    0,
  );
  const numeric = [
    finite(candidate.rank, 1),
    1 / Math.max(1, finite(candidate.rank, 1)),
    bounded(candidate.historicalProbability, 0, 1),
    bounded(candidate.generatorScore, 0, 10),
    bounded(candidate.confidence, 0, 1),
    Math.log1p(Math.max(0, finite(candidate.cost))),
    bounded(candidate.costToNetWorthRatio ?? 0, 0, 8),
    bounded(candidate.missingComponentCount, 0, 16),
    bounded(candidate.previousActionCount, 0, 16),
    bounded(candidate.inventoryTagOverlapCount, 0, 32),
    bounded(row.state.gameTimeS / 60, 0, 120),
    Math.log1p(Math.max(0, finite(row.state.netWorth))),
    bounded(candidate.tier ?? 0, 0, 8),
    bounded(inventorySize, 0, 32),
    healthRatio(row),
  ];
  const categorical = [
    categoryHash(`ITEM:${candidate.itemId}`),
    categoryHash(`ACTION:${candidate.actionKey}`),
    categoryHash(`HERO_ITEM:${row.state.heroId}:${candidate.itemId}`),
    categoryHash(`PHASE_ITEM:${row.state.phase}:${candidate.itemId}`),
    categoryHash(`TIME_ITEM:${timeBucket}:${candidate.itemId}`),
    categoryHash(`ECONOMY_ITEM:${economy}:${candidate.itemId}`),
    categoryHash(`HERO_SLOT:${row.state.heroId}:${candidate.slotType ?? 'UNKNOWN'}`),
    categoryHash(`ACTION_TYPE:${candidate.actionType}`),
    categoryHash(`SLOT_TYPE:${candidate.slotType ?? 'UNKNOWN'}`),
    categoryHash(`LAST_ACTION_ITEM:${lastAction}:${candidate.itemId}`),
  ];
  return { numeric, categorical };
}

export function recommendationBehavioralV6BoostedBaseScore(rank: number): number {
  if (!Number.isFinite(rank) || rank < 1) {
    throw new Error('Behavioral V6 boosted candidate rank must be >= 1.');
  }
  return -Math.log(rank);
}

export function recommendationBehavioralV6BoostedStumpContribution(
  stump: RecommendationBehavioralV6BoostedStump,
  features: RecommendationBehavioralV6BoostedFeatureVector,
): number {
  const left = recommendationBehavioralV6BoostedSplitGoesLeft(stump.split, features);
  return left ? stump.leftValue : stump.rightValue;
}

export function recommendationBehavioralV6BoostedSplitGoesLeft(
  split: RecommendationBehavioralV6BoostedSplit,
  features: RecommendationBehavioralV6BoostedFeatureVector,
): boolean {
  if (split.kind === 'NUMERIC_LE') {
    return features.numeric[split.featureIndex] <= split.threshold;
  }
  return features.categorical[split.featureIndex] === split.categoryHash;
}

export function recommendationBehavioralV6BoostedCandidateScore(
  model: RecommendationBehavioralV6BoostedModel,
  candidate: RecommendationDatasetV6CandidateFeatures,
  features: RecommendationBehavioralV6BoostedFeatureVector,
): { baseScore: number; boostedScore: number; score: number } {
  const baseScore = recommendationBehavioralV6BoostedBaseScore(candidate.rank);
  const boostedScore = model.trees.reduce(
    (sum, stump) =>
      sum + model.learningRate * recommendationBehavioralV6BoostedStumpContribution(stump, features),
    0,
  );
  return { baseScore, boostedScore, score: baseScore + boostedScore };
}

export function predictRecommendationBehavioralV6Boosted(
  model: RecommendationBehavioralV6BoostedModel,
  row: RecommendationProDecisionDatasetV6Row,
): RecommendationBehavioralV6BoostedPrediction {
  validateRecommendationBehavioralV6BoostedModel(model);
  validatePredictionRow(row);
  const scored = row.candidates.map((candidate) => {
    const features = recommendationBehavioralV6BoostedFeatureVector(row, candidate);
    return {
      candidate,
      ...recommendationBehavioralV6BoostedCandidateScore(model, candidate, features),
    };
  });
  const probabilities = softmax(scored.map((value) => value.score));
  const ranked = scored
    .map((value, index) => ({
      actionKey: value.candidate.actionKey,
      itemId: value.candidate.itemId,
      baseScore: value.baseScore,
      boostedScore: value.boostedScore,
      score: value.score,
      probability: probabilities[index],
      rank: 0,
    }))
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
  };
}

function validateConfig(config: RecommendationBehavioralV6BoostedModelConfig): void {
  if (!Number.isFinite(config.learningRate) || config.learningRate <= 0 || config.learningRate > 1) {
    throw new Error('Behavioral V6 boosted learningRate must be in (0, 1].');
  }
  if (!Number.isFinite(config.leafL2) || config.leafL2 < 0 || config.leafL2 > 1_000_000) {
    throw new Error('Behavioral V6 boosted leafL2 must be in [0, 1000000].');
  }
  if (
    !Number.isFinite(config.maximumLeafValue) ||
    config.maximumLeafValue <= 0 ||
    config.maximumLeafValue > 10
  ) {
    throw new Error('Behavioral V6 boosted maximumLeafValue must be in (0, 10].');
  }
  if (
    !Number.isSafeInteger(config.minimumLeafCandidateCount) ||
    config.minimumLeafCandidateCount < 10 ||
    config.minimumLeafCandidateCount > 1_000_000
  ) {
    throw new Error('Behavioral V6 boosted minimumLeafCandidateCount must be between 10 and 1000000.');
  }
}

function validateStump(stump: RecommendationBehavioralV6BoostedStump, expectedRound: number): void {
  if (
    !Number.isFinite(stump.leftValue) ||
    !Number.isFinite(stump.rightValue) ||
    !Number.isFinite(stump.gain) ||
    stump.gain < 0 ||
    !Number.isSafeInteger(stump.leftCandidateCount) ||
    stump.leftCandidateCount < 0 ||
    !Number.isSafeInteger(stump.rightCandidateCount) ||
    stump.rightCandidateCount < 0 ||
    stump.round !== expectedRound
  ) {
    throw new Error('Behavioral V6 boosted stump metadata is invalid.');
  }
  if (stump.split.kind === 'NUMERIC_LE') {
    if (
      !Number.isSafeInteger(stump.split.featureIndex) ||
      stump.split.featureIndex < 0 ||
      stump.split.featureIndex >= RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_NUMERIC_FEATURES.length ||
      !Number.isFinite(stump.split.threshold)
    ) {
      throw new Error('Behavioral V6 boosted numeric split is invalid.');
    }
    return;
  }
  if (
    !Number.isSafeInteger(stump.split.featureIndex) ||
    stump.split.featureIndex < 0 ||
    stump.split.featureIndex >= RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_CATEGORICAL_FEATURES.length ||
    !Number.isSafeInteger(stump.split.categoryHash) ||
    stump.split.categoryHash < 0 ||
    stump.split.categoryHash > 0xffffffff
  ) {
    throw new Error('Behavioral V6 boosted categorical split is invalid.');
  }
}

function validatePredictionRow(row: RecommendationProDecisionDatasetV6Row): void {
  if (!row.decisionId.trim() || !row.matchId.trim()) {
    throw new Error('Behavioral V6 boosted row identity is required.');
  }
  if (row.candidates.length < 2) {
    throw new Error('Behavioral V6 boosted prediction requires at least two candidates.');
  }
  const keys = new Set<string>();
  for (const candidate of row.candidates) {
    if (!candidate.actionKey.trim() || keys.has(candidate.actionKey)) {
      throw new Error('Behavioral V6 boosted candidate action keys must be unique.');
    }
    keys.add(candidate.actionKey);
  }
}

function healthRatio(row: RecommendationProDecisionDatasetV6Row): number {
  const health = finite(row.state.health);
  const maxHealth = finite(row.state.maxHealth);
  return maxHealth > 0 ? bounded(health / maxHealth, 0, 2) : 0;
}

function economyBand(netWorth: number | undefined): string {
  const value = finite(netWorth);
  if (value < 5_000) return 'LT_5000';
  if (value < 10_000) return '5000_9999';
  if (value < 15_000) return '10000_14999';
  if (value < 20_000) return '15000_19999';
  return 'GE_20000';
}

function categoryHash(value: string): number {
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
    throw new Error('Behavioral V6 boosted softmax normalization failed.');
  }
  return weights.map((value) => value / total);
}

function bounded(value: number | undefined, minimum: number, maximum: number): number {
  const numeric = finite(value);
  return Math.min(maximum, Math.max(minimum, numeric));
}

function finite(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}
