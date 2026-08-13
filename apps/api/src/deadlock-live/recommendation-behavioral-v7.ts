import type { RecommendationProDecisionDatasetV7Row } from './recommendation-pro-decision-dataset-v7';

export const RECOMMENDATION_BEHAVIORAL_V7_SCHEMA_VERSION = 1;
export const RECOMMENDATION_BEHAVIORAL_V7_MODEL_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V7_CONDITIONAL_LOGIT_1_RAW_PROPENSITY' as const;
export const RECOMMENDATION_BEHAVIORAL_V7_FEATURE_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V7_FEATURES_1_OBSERVABILITY_INTERACTIONS' as const;
export const RECOMMENDATION_BEHAVIORAL_V7_PROBABILITY_CONTRACT =
  'RAW_SOFTMAX_WITHIN_DECISION' as const;
export const RECOMMENDATION_BEHAVIORAL_V7_OPTIMIZER =
  'AGGREGATED_HASH_GRADIENT_SINGLE_L2_UPDATE_1' as const;

export interface RecommendationBehavioralV7Config {
  hashDimension: number;
}

export interface RecommendationBehavioralV7Model
  extends RecommendationBehavioralV7Config {
  schemaVersion: typeof RECOMMENDATION_BEHAVIORAL_V7_SCHEMA_VERSION;
  modelVersion: typeof RECOMMENDATION_BEHAVIORAL_V7_MODEL_VERSION;
  featureVersion: typeof RECOMMENDATION_BEHAVIORAL_V7_FEATURE_VERSION;
  probabilityContract: typeof RECOMMENDATION_BEHAVIORAL_V7_PROBABILITY_CONTRACT;
  optimizerContract: typeof RECOMMENDATION_BEHAVIORAL_V7_OPTIMIZER;
  weights: number[];
  trainedDecisionCount: number;
}

export interface RecommendationBehavioralV7TrainingOptions {
  learningRate: number;
  l2: number;
  gradientClip: number;
}

export interface RecommendationBehavioralV7Prediction {
  candidates: Array<{
    actionKey: string;
    score: number;
    probability: number;
  }>;
  observedActionProbability: number;
  topActionKey: string;
}

export interface RecommendationBehavioralV7OptimizerAudit {
  rawFeatureTouches: number;
  uniqueParameterUpdates: number;
  repeatedTouchRate: number;
}

export function createRecommendationBehavioralV7Model(
  config: RecommendationBehavioralV7Config,
): RecommendationBehavioralV7Model {
  validateConfig(config);
  return {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V7_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V7_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V7_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V7_PROBABILITY_CONTRACT,
    optimizerContract: RECOMMENDATION_BEHAVIORAL_V7_OPTIMIZER,
    hashDimension: config.hashDimension,
    weights: Array.from({ length: config.hashDimension }, () => 0),
    trainedDecisionCount: 0,
  };
}

export function validateRecommendationBehavioralV7Model(
  model: RecommendationBehavioralV7Model,
): void {
  if (
    model.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V7_SCHEMA_VERSION ||
    model.modelVersion !== RECOMMENDATION_BEHAVIORAL_V7_MODEL_VERSION ||
    model.featureVersion !== RECOMMENDATION_BEHAVIORAL_V7_FEATURE_VERSION ||
    model.probabilityContract !== RECOMMENDATION_BEHAVIORAL_V7_PROBABILITY_CONTRACT ||
    model.optimizerContract !== RECOMMENDATION_BEHAVIORAL_V7_OPTIMIZER
  ) {
    throw new Error('Unsupported Recommendation Behavioral V7 model.');
  }
  validateConfig(model);
  if (model.weights.length !== model.hashDimension) {
    throw new Error('Behavioral V7 weight shape mismatch.');
  }
  if (!Number.isSafeInteger(model.trainedDecisionCount) || model.trainedDecisionCount < 0) {
    throw new Error('Behavioral V7 trainedDecisionCount is invalid.');
  }
  for (const weight of model.weights) {
    if (!Number.isFinite(weight)) throw new Error('Behavioral V7 weights must be finite.');
  }
}

export function recommendationBehavioralV7FeatureTokens(
  row: RecommendationProDecisionDatasetV7Row,
  actionKey: string,
): string[] {
  const candidate = row.candidates.find((value) => value.actionKey === actionKey);
  if (!candidate) throw new Error(`Unknown V7 candidate ${actionKey}.`);
  const tokens = [
    `ACTION:${actionKey}`,
    `HERO_ACTION:${row.state.heroId}:${actionKey}`,
    `PHASE_ACTION:${row.state.phase}:${actionKey}`,
    `TIME_ACTION:${Math.floor(row.state.gameTimeS / 300)}:${actionKey}`,
    `ECONOMY_ACTION:${economyBand(row.state.netWorth)}:${actionKey}`,
    `RANK:${Math.min(96, candidate.rank)}`,
    `RANK_ACTION:${rankBand(candidate.rank)}:${actionKey}`,
    `TYPE_ACTION:${candidate.actionType}:${actionKey}`,
    `ITEM:${candidate.itemId}`,
  ];
  for (const previous of row.state.previousActionKeys.slice(-4)) {
    tokens.push(`PREV_ACTION:${previous}:${actionKey}`);
  }
  for (const observation of row.observability) {
    const value = observation.missing
      ? 'MISSING'
      : observationValueBand(observation.value);
    tokens.push(`OBS:${observation.fieldName}:${value}:${actionKey}`);
    tokens.push(`OBS_FAMILY:${observation.family}:${value}:${actionKey}`);
    if (observation.alignmentAgeS !== undefined) {
      tokens.push(
        `OBS_AGE:${observation.fieldName}:${ageBand(observation.alignmentAgeS)}:${actionKey}`,
      );
    }
  }
  for (const reason of candidate.feasibility.reasonCodes) {
    tokens.push(`AVAILABILITY:${reason}:${actionKey}`);
  }
  return [...new Set(tokens)];
}

export function predictRecommendationBehavioralV7(
  model: RecommendationBehavioralV7Model,
  row: RecommendationProDecisionDatasetV7Row,
): RecommendationBehavioralV7Prediction {
  validateModelHeader(model);
  validateRow(row);
  const scores = row.candidates.map((candidate) => ({
    actionKey: candidate.actionKey,
    score: scoreCandidate(model, row, candidate.actionKey),
  }));
  const probabilities = softmax(scores.map((value) => value.score));
  const candidates = scores.map((value, index) => ({
    ...value,
    probability: probabilities[index],
  }));
  let top = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (
      candidate.probability > top.probability ||
      (candidate.probability === top.probability &&
        candidate.actionKey.localeCompare(top.actionKey) < 0)
    ) {
      top = candidate;
    }
  }
  return {
    candidates,
    observedActionProbability:
      candidates.find((candidate) => candidate.actionKey === row.observedActionKey)
        ?.probability ?? 0,
    topActionKey: top.actionKey,
  };
}

export function trainRecommendationBehavioralV7Decision(
  model: RecommendationBehavioralV7Model,
  row: RecommendationProDecisionDatasetV7Row,
  options: RecommendationBehavioralV7TrainingOptions,
): { loss: number; optimizerAudit: RecommendationBehavioralV7OptimizerAudit } {
  validateModelHeader(model);
  validateTrainingOptions(options);
  validateRow(row);
  const observedIndex = row.candidates.findIndex(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  if (observedIndex < 0) {
    throw new Error('Behavioral V7 observed action is outside candidate set.');
  }
  const scores = row.candidates.map((candidate) =>
    scoreCandidate(model, row, candidate.actionKey),
  );
  const probabilities = softmax(scores);
  const gradients = new Map<number, number>();
  let rawFeatureTouches = 0;
  for (let candidateIndex = 0; candidateIndex < row.candidates.length; candidateIndex += 1) {
    const candidate = row.candidates[candidateIndex];
    const error = probabilities[candidateIndex] - (candidateIndex === observedIndex ? 1 : 0);
    for (const token of recommendationBehavioralV7FeatureTokens(row, candidate.actionKey)) {
      rawFeatureTouches += 1;
      const index = hashToken(token) % model.hashDimension;
      gradients.set(index, (gradients.get(index) ?? 0) + error);
    }
  }
  for (const [index, dataGradient] of gradients) {
    const weight = model.weights[index];
    const gradient = dataGradient + options.l2 * weight;
    model.weights[index] -=
      options.learningRate * clip(gradient, options.gradientClip);
  }
  model.trainedDecisionCount += 1;
  return {
    loss: -Math.log(Math.max(probabilities[observedIndex], 1e-15)),
    optimizerAudit: {
      rawFeatureTouches,
      uniqueParameterUpdates: gradients.size,
      repeatedTouchRate:
        rawFeatureTouches > 0
          ? 1 - gradients.size / rawFeatureTouches
          : 0,
    },
  };
}

function scoreCandidate(
  model: RecommendationBehavioralV7Model,
  row: RecommendationProDecisionDatasetV7Row,
  actionKey: string,
): number {
  let score = 0;
  for (const token of recommendationBehavioralV7FeatureTokens(row, actionKey)) {
    score += model.weights[hashToken(token) % model.hashDimension];
  }
  return score;
}

function validateRow(row: RecommendationProDecisionDatasetV7Row): void {
  if (
    row.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1' ||
    row.observabilityVersion !== 'RECOMMENDATION_OBSERVABILITY_V7_STRICT_PREDECISION_1' ||
    row.candidates.length < 2
  ) {
    throw new Error('Invalid Behavioral V7 row.');
  }
  if (
    row.choiceSet.observedActionInjected !== false ||
    row.choiceSet.selectedAfterObservedAction !== false
  ) {
    throw new Error('Behavioral V7 choice set violates pre-decision construction.');
  }
}

function validateModelHeader(model: RecommendationBehavioralV7Model): void {
  if (
    model.modelVersion !== RECOMMENDATION_BEHAVIORAL_V7_MODEL_VERSION ||
    model.featureVersion !== RECOMMENDATION_BEHAVIORAL_V7_FEATURE_VERSION ||
    model.probabilityContract !== RECOMMENDATION_BEHAVIORAL_V7_PROBABILITY_CONTRACT ||
    model.optimizerContract !== RECOMMENDATION_BEHAVIORAL_V7_OPTIMIZER ||
    model.weights.length !== model.hashDimension
  ) {
    throw new Error('Invalid Behavioral V7 model header.');
  }
}

function validateConfig(config: RecommendationBehavioralV7Config): void {
  if (!Number.isSafeInteger(config.hashDimension) || config.hashDimension < 1024) {
    throw new Error('Behavioral V7 hashDimension must be an integer >= 1024.');
  }
}

function validateTrainingOptions(
  options: RecommendationBehavioralV7TrainingOptions,
): void {
  if (!Number.isFinite(options.learningRate) || options.learningRate <= 0) {
    throw new Error('Behavioral V7 learningRate must be positive.');
  }
  if (!Number.isFinite(options.l2) || options.l2 < 0) {
    throw new Error('Behavioral V7 l2 must be non-negative.');
  }
  if (!Number.isFinite(options.gradientClip) || options.gradientClip <= 0) {
    throw new Error('Behavioral V7 gradientClip must be positive.');
  }
}

function softmax(scores: readonly number[]): number[] {
  const maximum = Math.max(...scores);
  const exp = scores.map((score) => Math.exp(score - maximum));
  const total = exp.reduce((sum, value) => sum + value, 0);
  return exp.map((value) => value / total);
}

function economyBand(value?: number): string {
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if ((value as number) < 5000) return 'LT_5000';
  if ((value as number) < 10000) return '5000_9999';
  if ((value as number) < 15000) return '10000_14999';
  if ((value as number) < 20000) return '15000_19999';
  return 'GE_20000';
}

function rankBand(rank: number): string {
  if (rank <= 5) return '1_5';
  if (rank <= 10) return '6_10';
  if (rank <= 20) return '11_20';
  if (rank <= 50) return '21_50';
  return '51_96';
}

function ageBand(ageS: number): string {
  if (ageS <= 1) return 'LE_1';
  if (ageS <= 5) return 'LE_5';
  if (ageS <= 15) return 'LE_15';
  if (ageS <= 30) return 'LE_30';
  return 'GT_30';
}

function observationValueBand(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NONFINITE';
    const absolute = Math.abs(value);
    const width =
      absolute >= 10000
        ? 5000
        : absolute >= 1000
          ? 500
          : absolute >= 100
            ? 50
            : absolute >= 10
              ? 5
              : 1;
    return String(Math.floor(value / width) * width);
  }
  if (Array.isArray(value)) return `ARRAY_${value.length}`;
  return String(value);
}

function hashToken(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function clip(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}
