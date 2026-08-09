import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';

export const RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION = 2;
export const RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V5_1_HASHED_CONDITIONAL_CHOICE_2_RAW_PROPENSITY' as const;
export const RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_4_CAPACITY_INTERACTIONS' as const;

export interface RecommendationBehavioralV5Model {
  schemaVersion: typeof RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION;
  modelVersion: typeof RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION;
  featureVersion: typeof RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION;
  hashDimension: number;
  weights: number[];
  trainedDecisionCount: number;
  updateCount: number;
}

export interface RecommendationBehavioralV5CandidateProbability {
  actionKey: string;
  itemId: number;
  score: number;
  probability: number;
  rank: number;
}

export interface RecommendationBehavioralV5Prediction {
  candidates: RecommendationBehavioralV5CandidateProbability[];
  observedActionKey: string;
  observedActionProbability: number;
  topActionKey: string;
  entropy: number;
  maximumProbability: number;
  minimumProbability: number;
}

export interface RecommendationBehavioralV5TrainingStepOptions {
  learningRate: number;
  l2: number;
}

interface SparseFeature {
  index: number;
  value: number;
}

export function createRecommendationBehavioralV5Model(
  hashDimension: number,
): RecommendationBehavioralV5Model {
  if (!Number.isSafeInteger(hashDimension) || hashDimension < 256) {
    throw new Error('Behavioral V5 hashDimension must be at least 256.');
  }
  return {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION,
    hashDimension,
    weights: Array.from({ length: hashDimension }, () => 0),
    trainedDecisionCount: 0,
    updateCount: 0,
  };
}

export function cloneRecommendationBehavioralV5Model(
  model: RecommendationBehavioralV5Model,
): RecommendationBehavioralV5Model {
  validateRecommendationBehavioralV5Model(model);
  return {
    ...model,
    weights: [...model.weights],
  };
}

export function validateRecommendationBehavioralV5Model(
  model: RecommendationBehavioralV5Model,
): void {
  if (
    model.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION ||
    model.modelVersion !== RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION ||
    model.featureVersion !== RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION
  ) {
    throw new Error('Unsupported Recommendation Behavioral V5 model.');
  }
  if (
    !Number.isSafeInteger(model.hashDimension) ||
    model.hashDimension < 256 ||
    model.weights.length !== model.hashDimension ||
    model.weights.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('Invalid Recommendation Behavioral V5 model weights.');
  }
}

export function trainRecommendationBehavioralV5Decision(
  model: RecommendationBehavioralV5Model,
  row: RecommendationProDecisionDatasetV6Row,
  options: RecommendationBehavioralV5TrainingStepOptions,
): number {
  validateRecommendationBehavioralV5Model(model);
  validateTrainingRow(row);
  validateTrainingStepOptions(options);
  const featureSets = row.candidates.map((candidate) =>
    candidateFeatures(row, candidate, model.hashDimension),
  );
  const scores = featureSets.map((features) => dot(model.weights, features));
  const probabilities = softmax(scores);
  const observedIndex = row.candidates.findIndex(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  if (observedIndex < 0) {
    throw new Error('Behavioral V5 observed action is outside the candidate set.');
  }
  const learningRate =
    options.learningRate / Math.sqrt(Math.max(1, model.updateCount + 1));
  for (let candidateIndex = 0; candidateIndex < featureSets.length; candidateIndex += 1) {
    const error = probabilities[candidateIndex] -
      (candidateIndex === observedIndex ? 1 : 0);
    for (const feature of featureSets[candidateIndex]) {
      const weight = model.weights[feature.index];
      const gradient = error * feature.value + options.l2 * weight;
      model.weights[feature.index] = weight - learningRate * gradient;
    }
  }
  model.trainedDecisionCount += 1;
  model.updateCount += 1;
  return -Math.log(Math.max(probabilities[observedIndex], 1e-15));
}

export function predictRecommendationBehavioralV5(
  model: RecommendationBehavioralV5Model,
  row: RecommendationProDecisionDatasetV6Row,
): RecommendationBehavioralV5Prediction {
  validateRecommendationBehavioralV5Model(model);
  validatePredictionRow(row);
  const scored = row.candidates.map((candidate) => ({
    candidate,
    score: dot(
      model.weights,
      candidateFeatures(row, candidate, model.hashDimension),
    ),
  }));
  const probabilities = softmax(scored.map((value) => value.score));
  const ranked = scored
    .map((value, index) => ({
      actionKey: value.candidate.actionKey,
      itemId: value.candidate.itemId,
      score: value.score,
      probability: probabilities[index],
      rank: 0,
    }))
    .sort(
      (left, right) =>
        right.probability - left.probability ||
        left.actionKey.localeCompare(right.actionKey),
    )
    .map((value, index) => ({ ...value, rank: index + 1 }));
  const observed = ranked.find(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  const probabilityValues = ranked.map((candidate) => candidate.probability);
  return {
    candidates: ranked,
    observedActionKey: row.observedActionKey,
    observedActionProbability: observed?.probability ?? 0,
    topActionKey: ranked[0].actionKey,
    entropy: -probabilityValues.reduce(
      (sum, probability) =>
        sum + (probability <= 0 ? 0 : probability * Math.log(probability)),
      0,
    ),
    maximumProbability: Math.max(...probabilityValues),
    minimumProbability: Math.min(...probabilityValues),
  };
}

export function stabilizeRecommendationBehavioralV5ObservedProbability(
  probability: number,
  floor: number,
): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error('Behavioral V5 observed probability must be in [0, 1].');
  }
  if (!Number.isFinite(floor) || floor < 0 || floor >= 1) {
    throw new Error('Behavioral V5 probability floor must be in [0, 1).');
  }
  return Math.max(probability, floor);
}

export function recommendationBehavioralV5DiagnosticMatchSelected(
  matchId: string,
  modulo: number,
  remainder: number,
): boolean {
  if (!matchId.trim()) {
    throw new Error('Behavioral V5 matchId is required for diagnostic sampling.');
  }
  if (!Number.isSafeInteger(modulo) || modulo < 2 || modulo > 10_000) {
    throw new Error('Behavioral V5 diagnostic sample modulo must be between 2 and 10000.');
  }
  if (
    !Number.isSafeInteger(remainder) ||
    remainder < 0 ||
    remainder >= modulo
  ) {
    throw new Error(
      'Behavioral V5 diagnostic sample remainder must be in [0, modulo).',
    );
  }
  return fnv1a(matchId) % modulo === remainder;
}

export function recommendationBehavioralV5FoldId(
  matchId: string,
  foldCount: number,
): number {
  if (!matchId.trim()) {
    throw new Error('Behavioral V5 matchId is required for fold assignment.');
  }
  if (!Number.isSafeInteger(foldCount) || foldCount < 2 || foldCount > 20) {
    throw new Error('Behavioral V5 foldCount must be between 2 and 20.');
  }
  return fnv1a(matchId) % foldCount;
}

export function recommendationBehavioralV5FeatureCount(
  row: RecommendationProDecisionDatasetV6Row,
  candidate: RecommendationDatasetV6CandidateFeatures,
  hashDimension: number,
): number {
  return candidateFeatures(row, candidate, hashDimension).length;
}

function candidateFeatures(
  row: RecommendationProDecisionDatasetV6Row,
  candidate: RecommendationDatasetV6CandidateFeatures,
  hashDimension: number,
): SparseFeature[] {
  const features = new Map<number, number>();
  const add = (key: string, value = 1): void => {
    if (!Number.isFinite(value) || value === 0) {
      return;
    }
    const hash = fnv1a(key);
    const index = hash % hashDimension;
    const sign = (hash & 0x80000000) === 0 ? 1 : -1;
    features.set(index, (features.get(index) ?? 0) + sign * value);
  };
  const heroId = row.state.heroId;
  const itemId = candidate.itemId;
  const timeBucket = Math.floor(row.state.gameTimeS / 300);
  const economy = behavioralEconomyBand(row.state.netWorth);

  add('bias');
  add(
    'timeline-future-fallback',
    row.state.timelineSnapshotFutureFallback === true ? 1 : 0,
  );
  add(
    'timeline-snapshot-lag',
    bounded(row.state.timelineSnapshotLagS ?? 0, -300, 300) / 300,
  );
  add(`item:${itemId}`);
  add(`action:${candidate.actionKey}`);
  add(`hero-item:${heroId}:${itemId}`);
  add(`phase-item:${row.state.phase}:${itemId}`);
  add(`time-item:${timeBucket}:${itemId}`);
  add(`time-bucket-action:${timeBucket}:${candidate.actionKey}`);
  add(`hero-time-bucket-item:${heroId}:${timeBucket}:${itemId}`);
  add(`economy-band-item:${economy}:${itemId}`);
  add(`economy-band-action:${economy}:${candidate.actionKey}`);
  add(`action-type:${candidate.actionType}`);
  add(`slot:${candidate.slotType ?? 'UNKNOWN'}`);
  add(`hero-slot:${heroId}:${candidate.slotType ?? 'UNKNOWN'}`);
  add(`tier:${candidate.tier ?? -1}`);
  add(`active:${candidate.isActiveItem === true ? 1 : 0}`);
  add(`item-active:${itemId}:${candidate.isActiveItem === true ? 1 : 0}`);

  for (const tag of candidate.tags) {
    add(`tag:${tag}`);
    add(`hero-tag:${heroId}:${tag}`);
    add(`item-tag:${itemId}:${tag}`);
    add(`inventory-tag-overlap:${tag}`, bounded(
      row.state.inventoryTagCounts[tag] ?? 0,
      0,
      8,
    ) / 8);
  }
  for (const allyHeroId of row.state.alliedHeroIds) {
    add(`ally-item:${allyHeroId}:${itemId}`, 0.2);
  }
  for (const enemyHeroId of row.state.enemyHeroIds) {
    add(`enemy-item:${enemyHeroId}:${itemId}`, 0.25);
  }

  add('generator-score', bounded(candidate.generatorScore, -10, 10) / 10);
  add('historical-probability', bounded(candidate.historicalProbability, 0, 1));
  add('generator-confidence', bounded(candidate.confidence, 0, 1));
  add('inverse-rank', 1 / Math.max(1, candidate.rank));
  add('log-historical-count', Math.log1p(Math.max(0, candidate.historicalCount)) / 12);
  add('log-cost', Math.log1p(Math.max(0, candidate.cost ?? 0)) / 12);
  add('tier-value', bounded(candidate.tier ?? 0, 0, 4) / 4);
  add('required-components', bounded(candidate.requiredComponentCount, 0, 8) / 8);
  add('owned-components', bounded(candidate.ownedComponentCount, 0, 8) / 8);
  add('missing-components', bounded(candidate.missingComponentCount, 0, 8) / 8);
  add('complete-recipe', candidate.hasCompleteRecipeComponents ? 1 : 0);
  add('already-owned', bounded(candidate.alreadyOwnedCount, 0, 4) / 4);
  add('same-slot-owned', bounded(candidate.sameSlotOwnedItemCount, 0, 8) / 8);
  add('inventory-tag-overlap-count', bounded(candidate.inventoryTagOverlapCount, 0, 16) / 16);
  add('previous-action-count', bounded(candidate.previousActionCount, 0, 4) / 4);
  add('cost-networth-ratio', bounded(candidate.costToNetWorthRatio ?? 0, 0, 2) / 2);

  add(`item-networth:${itemId}`, Math.log1p(Math.max(0, row.state.netWorth ?? 0)) / 12);
  add(`item-kills:${itemId}`, bounded(row.state.kills ?? 0, 0, 30) / 30);
  add(`item-deaths:${itemId}`, bounded(row.state.deaths ?? 0, 0, 30) / 30);
  add(`item-assists:${itemId}`, bounded(row.state.assists ?? 0, 0, 40) / 40);
  add(`item-level:${itemId}`, bounded(row.state.level ?? 0, 0, 30) / 30);
  add(`item-health-ratio:${itemId}`, healthRatio(row));
  add(`item-inventory-size:${itemId}`, bounded(
    row.state.inventoryItemCounts.reduce((sum, value) => sum + value.count, 0),
    0,
    16,
  ) / 16);

  return [...features.entries()]
    .map(([index, value]) => ({ index, value }))
    .filter((feature) => Number.isFinite(feature.value) && feature.value !== 0)
    .sort((left, right) => left.index - right.index);
}

function validateTrainingRow(row: RecommendationProDecisionDatasetV6Row): void {
  validatePredictionRow(row);
  if (!row.eligibility.behavioralModel) {
    throw new Error('Behavioral V5 row is not behavior-model eligible.');
  }
  if (!row.observedActionInCandidateSet) {
    throw new Error('Behavioral V5 observed action is outside the candidate set.');
  }
}

function validatePredictionRow(row: RecommendationProDecisionDatasetV6Row): void {
  if (!row.decisionId.trim() || !row.matchId.trim()) {
    throw new Error('Behavioral V5 row identity is required.');
  }
  if (row.candidates.length < 2) {
    throw new Error('Behavioral V5 requires at least two candidates.');
  }
  const actionKeys = new Set<string>();
  for (const candidate of row.candidates) {
    if (!candidate.actionKey.trim() || actionKeys.has(candidate.actionKey)) {
      throw new Error('Behavioral V5 candidate action keys must be unique.');
    }
    actionKeys.add(candidate.actionKey);
  }
}

function validateTrainingStepOptions(
  options: RecommendationBehavioralV5TrainingStepOptions,
): void {
  if (
    !Number.isFinite(options.learningRate) ||
    options.learningRate <= 0 ||
    options.learningRate > 10
  ) {
    throw new Error('Behavioral V5 learningRate must be in (0, 10].');
  }
  if (!Number.isFinite(options.l2) || options.l2 < 0 || options.l2 > 1) {
    throw new Error('Behavioral V5 l2 must be in [0, 1].');
  }
}

function dot(weights: readonly number[], features: readonly SparseFeature[]): number {
  return features.reduce(
    (sum, feature) => sum + weights[feature.index] * feature.value,
    0,
  );
}

function softmax(scores: readonly number[]): number[] {
  if (scores.length === 0 || scores.some((score) => !Number.isFinite(score))) {
    throw new Error('Behavioral V5 scores must be finite and non-empty.');
  }
  const maximum = Math.max(...scores);
  const exponentials = scores.map((score) => Math.exp(score - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Behavioral V5 softmax normalization failed.');
  }
  return exponentials.map((value) => value / total);
}

function healthRatio(row: RecommendationProDecisionDatasetV6Row): number {
  const health = row.state.health;
  const maxHealth = row.state.maxHealth;
  if (
    health === undefined ||
    maxHealth === undefined ||
    !Number.isFinite(health) ||
    !Number.isFinite(maxHealth) ||
    maxHealth <= 0
  ) {
    return 0;
  }
  return bounded(health / maxHealth, 0, 1);
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function behavioralEconomyBand(netWorth: number | undefined): string {
  if (netWorth === undefined || !Number.isFinite(netWorth)) {
    return 'UNKNOWN';
  }
  if (netWorth < 5_000) {
    return 'LT_5000';
  }
  if (netWorth < 10_000) {
    return '5000_9999';
  }
  if (netWorth < 20_000) {
    return '10000_19999';
  }
  return 'GE_20000';
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
