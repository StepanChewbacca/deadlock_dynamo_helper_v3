import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';

export const RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION = 1;
export const RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V5_2_LOW_RANK_TWO_TOWER_1_RAW_PROPENSITY' as const;
export const RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V5_2_FEATURES_1_TWO_TOWER' as const;
export const RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT =
  'RAW_SOFTMAX_WITHIN_DECISION' as const;

export interface RecommendationBehavioralV52ModelConfig {
  linearHashDimension: number;
  embeddingHashDimension: number;
  latentDimension: number;
  candidateInitializationScale?: number;
}

export interface RecommendationBehavioralV52Model {
  schemaVersion: typeof RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION;
  modelVersion: typeof RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION;
  featureVersion: typeof RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION;
  probabilityContract: typeof RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT;
  linearHashDimension: number;
  embeddingHashDimension: number;
  latentDimension: number;
  candidateInitializationScale: number;
  linearWeights: number[];
  contextEmbeddings: number[];
  candidateEmbeddings: number[];
  trainedDecisionCount: number;
  updateCount: number;
}

export interface RecommendationBehavioralV52CandidateProbability {
  actionKey: string;
  itemId: number;
  linearScore: number;
  interactionScore: number;
  score: number;
  probability: number;
  rank: number;
}

export interface RecommendationBehavioralV52Prediction {
  candidates: RecommendationBehavioralV52CandidateProbability[];
  observedActionKey: string;
  observedActionProbability: number;
  topActionKey: string;
  entropy: number;
  maximumProbability: number;
  minimumProbability: number;
}

export interface RecommendationBehavioralV52TrainingStepOptions {
  learningRate: number;
  l2: number;
}

export interface RecommendationBehavioralV52FeatureCounts {
  linear: number;
  contextTower: number;
  candidateTower: number;
}

interface SparseFeature {
  index: number;
  value: number;
}

interface CandidateComputation {
  candidate: RecommendationDatasetV6CandidateFeatures;
  linearFeatures: SparseFeature[];
  towerFeatures: SparseFeature[];
  candidateVector: number[];
  linearScore: number;
  interactionScore: number;
  score: number;
}

const DEFAULT_CANDIDATE_INITIALIZATION_SCALE = 0.05;

export function createRecommendationBehavioralV52Model(
  config: RecommendationBehavioralV52ModelConfig,
): RecommendationBehavioralV52Model {
  validateModelConfig(config);
  const candidateInitializationScale =
    config.candidateInitializationScale ?? DEFAULT_CANDIDATE_INITIALIZATION_SCALE;
  if (
    !Number.isFinite(candidateInitializationScale) ||
    candidateInitializationScale <= 0 ||
    candidateInitializationScale > 1
  ) {
    throw new Error(
      'Behavioral V5.2 candidateInitializationScale must be in (0, 1].',
    );
  }
  const embeddingValueCount =
    config.embeddingHashDimension * config.latentDimension;
  const candidateEmbeddings = Array.from(
    { length: embeddingValueCount },
    (_, offset) =>
      deterministicCandidateEmbeddingValue(
        offset,
        config.latentDimension,
        candidateInitializationScale,
      ),
  );
  return {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
    linearHashDimension: config.linearHashDimension,
    embeddingHashDimension: config.embeddingHashDimension,
    latentDimension: config.latentDimension,
    candidateInitializationScale,
    linearWeights: Array.from({ length: config.linearHashDimension }, () => 0),
    contextEmbeddings: Array.from({ length: embeddingValueCount }, () => 0),
    candidateEmbeddings,
    trainedDecisionCount: 0,
    updateCount: 0,
  };
}

export function cloneRecommendationBehavioralV52Model(
  model: RecommendationBehavioralV52Model,
): RecommendationBehavioralV52Model {
  validateRecommendationBehavioralV52Model(model);
  return {
    ...model,
    linearWeights: [...model.linearWeights],
    contextEmbeddings: [...model.contextEmbeddings],
    candidateEmbeddings: [...model.candidateEmbeddings],
  };
}

export function validateRecommendationBehavioralV52Model(
  model: RecommendationBehavioralV52Model,
): void {
  if (
    model.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION ||
    model.modelVersion !== RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION ||
    model.featureVersion !== RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION ||
    model.probabilityContract !==
      RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT
  ) {
    throw new Error('Unsupported Recommendation Behavioral V5.2 model.');
  }
  validateModelConfig({
    linearHashDimension: model.linearHashDimension,
    embeddingHashDimension: model.embeddingHashDimension,
    latentDimension: model.latentDimension,
    candidateInitializationScale: model.candidateInitializationScale,
  });
  const expectedEmbeddingValueCount =
    model.embeddingHashDimension * model.latentDimension;
  if (
    model.linearWeights.length !== model.linearHashDimension ||
    model.contextEmbeddings.length !== expectedEmbeddingValueCount ||
    model.candidateEmbeddings.length !== expectedEmbeddingValueCount ||
    model.linearWeights.some((value) => !Number.isFinite(value)) ||
    model.contextEmbeddings.some((value) => !Number.isFinite(value)) ||
    model.candidateEmbeddings.some((value) => !Number.isFinite(value)) ||
    !Number.isSafeInteger(model.trainedDecisionCount) ||
    model.trainedDecisionCount < 0 ||
    !Number.isSafeInteger(model.updateCount) ||
    model.updateCount < 0
  ) {
    throw new Error('Invalid Recommendation Behavioral V5.2 model weights.');
  }
}

export function trainRecommendationBehavioralV52Decision(
  model: RecommendationBehavioralV52Model,
  row: RecommendationProDecisionDatasetV6Row,
  options: RecommendationBehavioralV52TrainingStepOptions,
): number {
  validateRecommendationBehavioralV52Model(model);
  validateTrainingRow(row);
  validateTrainingStepOptions(options);

  const contextFeatures = contextTowerFeatures(
    row,
    model.embeddingHashDimension,
  );
  const contextVector = towerVector(
    model.contextEmbeddings,
    contextFeatures,
    model.latentDimension,
  );
  const computations = candidateComputations(model, row, contextVector);
  const probabilities = softmax(computations.map((value) => value.score));
  const observedIndex = row.candidates.findIndex(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  if (observedIndex < 0) {
    throw new Error(
      'Behavioral V5.2 observed action is outside the candidate set.',
    );
  }

  const learningRate =
    options.learningRate / Math.sqrt(Math.max(1, model.updateCount + 1));
  const errors = probabilities.map(
    (probability, index) => probability - (index === observedIndex ? 1 : 0),
  );

  for (let candidateIndex = 0; candidateIndex < computations.length; candidateIndex += 1) {
    const error = errors[candidateIndex];
    for (const feature of computations[candidateIndex].linearFeatures) {
      const weight = model.linearWeights[feature.index];
      const gradient = error * feature.value + options.l2 * weight;
      model.linearWeights[feature.index] = weight - learningRate * gradient;
    }
  }

  const contextVectorGradient = Array.from(
    { length: model.latentDimension },
    (_, latentIndex) =>
      computations.reduce(
        (sum, computation, candidateIndex) =>
          sum + errors[candidateIndex] * computation.candidateVector[latentIndex],
        0,
      ),
  );
  updateEmbeddingFeatures(
    model.contextEmbeddings,
    contextFeatures,
    contextVectorGradient,
    learningRate,
    options.l2,
    model.latentDimension,
  );

  for (let candidateIndex = 0; candidateIndex < computations.length; candidateIndex += 1) {
    const error = errors[candidateIndex];
    const candidateVectorGradient = contextVector.map(
      (value) => error * value,
    );
    updateEmbeddingFeatures(
      model.candidateEmbeddings,
      computations[candidateIndex].towerFeatures,
      candidateVectorGradient,
      learningRate,
      options.l2,
      model.latentDimension,
    );
  }

  model.trainedDecisionCount += 1;
  model.updateCount += 1;
  return -Math.log(Math.max(probabilities[observedIndex], 1e-15));
}

export function predictRecommendationBehavioralV52(
  model: RecommendationBehavioralV52Model,
  row: RecommendationProDecisionDatasetV6Row,
): RecommendationBehavioralV52Prediction {
  validateRecommendationBehavioralV52Model(model);
  validatePredictionRow(row);
  const contextFeatures = contextTowerFeatures(
    row,
    model.embeddingHashDimension,
  );
  const contextVector = towerVector(
    model.contextEmbeddings,
    contextFeatures,
    model.latentDimension,
  );
  const computations = candidateComputations(model, row, contextVector);
  const probabilities = softmax(computations.map((value) => value.score));
  const ranked = computations
    .map((value, index) => ({
      actionKey: value.candidate.actionKey,
      itemId: value.candidate.itemId,
      linearScore: value.linearScore,
      interactionScore: value.interactionScore,
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

export function stabilizeRecommendationBehavioralV52ObservedProbability(
  probability: number,
  floor: number,
): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error('Behavioral V5.2 observed probability must be in [0, 1].');
  }
  if (!Number.isFinite(floor) || floor < 0 || floor >= 1) {
    throw new Error('Behavioral V5.2 probability floor must be in [0, 1).');
  }
  return Math.max(probability, floor);
}

export function recommendationBehavioralV52FoldId(
  matchId: string,
  foldCount: number,
): number {
  if (!matchId.trim()) {
    throw new Error('Behavioral V5.2 matchId is required for fold assignment.');
  }
  if (!Number.isSafeInteger(foldCount) || foldCount < 2 || foldCount > 20) {
    throw new Error('Behavioral V5.2 foldCount must be between 2 and 20.');
  }
  return fnv1a(matchId) % foldCount;
}

export function recommendationBehavioralV52FeatureCounts(
  row: RecommendationProDecisionDatasetV6Row,
  candidate: RecommendationDatasetV6CandidateFeatures,
  model: RecommendationBehavioralV52Model,
): RecommendationBehavioralV52FeatureCounts {
  validateRecommendationBehavioralV52Model(model);
  return {
    linear: linearFeatures(row, candidate, model.linearHashDimension).length,
    contextTower: contextTowerFeatures(
      row,
      model.embeddingHashDimension,
    ).length,
    candidateTower: candidateTowerFeatures(
      candidate,
      model.embeddingHashDimension,
    ).length,
  };
}

function candidateComputations(
  model: RecommendationBehavioralV52Model,
  row: RecommendationProDecisionDatasetV6Row,
  contextVector: readonly number[],
): CandidateComputation[] {
  return row.candidates.map((candidate) => {
    const candidateLinearFeatures = linearFeatures(
      row,
      candidate,
      model.linearHashDimension,
    );
    const towerFeatures = candidateTowerFeatures(
      candidate,
      model.embeddingHashDimension,
    );
    const candidateVector = towerVector(
      model.candidateEmbeddings,
      towerFeatures,
      model.latentDimension,
    );
    const linearScore = dot(model.linearWeights, candidateLinearFeatures);
    const interactionScore = denseDot(contextVector, candidateVector);
    return {
      candidate,
      linearFeatures: candidateLinearFeatures,
      towerFeatures,
      candidateVector,
      linearScore,
      interactionScore,
      score: linearScore + interactionScore,
    };
  });
}

function contextTowerFeatures(
  row: RecommendationProDecisionDatasetV6Row,
  hashDimension: number,
): SparseFeature[] {
  const builder = sparseFeatureBuilder(hashDimension);
  const timeBucket = Math.floor(row.state.gameTimeS / 300);
  const economy = behavioralEconomyBand(row.state.netWorth);

  builder.add('context:bias');
  builder.add(`context:hero:${row.state.heroId}`);
  builder.add(`context:team:${row.state.team}`);
  builder.add(`context:phase:${row.state.phase}`);
  builder.add(`context:time:${timeBucket}`);
  builder.add(`context:economy:${economy}`);
  builder.add(
    'context:timeline-future-fallback',
    row.state.timelineSnapshotFutureFallback === true ? 1 : 0,
  );
  builder.add(
    'context:timeline-lag',
    bounded(row.state.timelineSnapshotLagS ?? 0, -300, 300) / 300,
  );
  builder.add(
    'context:log-networth',
    Math.log1p(Math.max(0, row.state.netWorth ?? 0)) / 12,
  );
  builder.add('context:kills', bounded(row.state.kills ?? 0, 0, 30) / 30);
  builder.add('context:deaths', bounded(row.state.deaths ?? 0, 0, 30) / 30);
  builder.add('context:assists', bounded(row.state.assists ?? 0, 0, 40) / 40);
  builder.add('context:level', bounded(row.state.level ?? 0, 0, 30) / 30);
  builder.add('context:health-ratio', healthRatio(row));
  builder.add(
    'context:inventory-size',
    bounded(
      row.state.inventoryItemCounts.reduce((sum, value) => sum + value.count, 0),
      0,
      16,
    ) / 16,
  );

  for (const item of row.state.inventoryItemCounts) {
    builder.add(`context:inventory-item:${item.itemId}`, bounded(item.count, 0, 4) / 4);
  }
  for (const [tag, count] of Object.entries(row.state.inventoryTagCounts)) {
    builder.add(`context:inventory-tag:${tag}`, bounded(count, 0, 8) / 8);
  }
  for (const allyHeroId of row.state.alliedHeroIds) {
    builder.add(`context:ally:${allyHeroId}`, 0.25);
  }
  for (const enemyHeroId of row.state.enemyHeroIds) {
    builder.add(`context:enemy:${enemyHeroId}`, 0.25);
  }
  for (const actionKey of row.state.previousActionKeys.slice(-4)) {
    builder.add(`context:previous-action:${actionKey}`, 0.5);
  }

  return normalizeSparseFeatures(builder.values());
}

function candidateTowerFeatures(
  candidate: RecommendationDatasetV6CandidateFeatures,
  hashDimension: number,
): SparseFeature[] {
  const builder = sparseFeatureBuilder(hashDimension);
  builder.add('candidate:bias');
  builder.add(`candidate:item:${candidate.itemId}`);
  builder.add(`candidate:action:${candidate.actionKey}`);
  builder.add(`candidate:action-type:${candidate.actionType}`);
  builder.add(`candidate:slot:${candidate.slotType ?? 'UNKNOWN'}`);
  builder.add(`candidate:item-type:${candidate.itemType ?? 'UNKNOWN'}`);
  builder.add(`candidate:tier:${candidate.tier ?? -1}`);
  builder.add(`candidate:active:${candidate.isActiveItem === true ? 1 : 0}`);
  builder.add(
    `candidate:activation:${candidate.activationType ?? 'NONE'}`,
  );
  for (const tag of candidate.tags) {
    builder.add(`candidate:tag:${tag}`);
  }
  for (const componentItemId of candidate.componentItemIds.slice(0, 4)) {
    builder.add(`candidate:component:${componentItemId}`, 0.5);
  }
  builder.add(
    'candidate:generator-score',
    bounded(candidate.generatorScore, -10, 10) / 10,
  );
  builder.add(
    'candidate:historical-probability',
    bounded(candidate.historicalProbability, 0, 1),
  );
  builder.add(
    'candidate:confidence',
    bounded(candidate.confidence, 0, 1),
  );
  builder.add('candidate:inverse-rank', 1 / Math.max(1, candidate.rank));
  builder.add(
    'candidate:log-cost',
    Math.log1p(Math.max(0, candidate.cost ?? 0)) / 12,
  );
  builder.add(
    'candidate:missing-components',
    bounded(candidate.missingComponentCount, 0, 8) / 8,
  );
  return normalizeSparseFeatures(builder.values());
}

function linearFeatures(
  row: RecommendationProDecisionDatasetV6Row,
  candidate: RecommendationDatasetV6CandidateFeatures,
  hashDimension: number,
): SparseFeature[] {
  const builder = sparseFeatureBuilder(hashDimension);
  const heroId = row.state.heroId;
  const itemId = candidate.itemId;
  const timeBucket = Math.floor(row.state.gameTimeS / 300);
  const economy = behavioralEconomyBand(row.state.netWorth);

  builder.add('bias');
  builder.add(
    'timeline-future-fallback',
    row.state.timelineSnapshotFutureFallback === true ? 1 : 0,
  );
  builder.add(
    'timeline-snapshot-lag',
    bounded(row.state.timelineSnapshotLagS ?? 0, -300, 300) / 300,
  );
  builder.add(`item:${itemId}`);
  builder.add(`action:${candidate.actionKey}`);
  builder.add(`hero-item:${heroId}:${itemId}`);
  builder.add(`phase-item:${row.state.phase}:${itemId}`);
  builder.add(`time-item:${timeBucket}:${itemId}`);
  builder.add(`time-bucket-action:${timeBucket}:${candidate.actionKey}`);
  builder.add(`hero-time-bucket-item:${heroId}:${timeBucket}:${itemId}`);
  builder.add(`economy-band-item:${economy}:${itemId}`);
  builder.add(`economy-band-action:${economy}:${candidate.actionKey}`);
  builder.add(`action-type:${candidate.actionType}`);
  builder.add(`slot:${candidate.slotType ?? 'UNKNOWN'}`);
  builder.add(`hero-slot:${heroId}:${candidate.slotType ?? 'UNKNOWN'}`);
  builder.add(`tier:${candidate.tier ?? -1}`);
  builder.add(`active:${candidate.isActiveItem === true ? 1 : 0}`);
  builder.add(`item-active:${itemId}:${candidate.isActiveItem === true ? 1 : 0}`);

  for (const tag of candidate.tags) {
    builder.add(`tag:${tag}`);
    builder.add(`hero-tag:${heroId}:${tag}`);
    builder.add(`item-tag:${itemId}:${tag}`);
    builder.add(
      `inventory-tag-overlap:${tag}`,
      bounded(row.state.inventoryTagCounts[tag] ?? 0, 0, 8) / 8,
    );
  }
  for (const allyHeroId of row.state.alliedHeroIds) {
    builder.add(`ally-item:${allyHeroId}:${itemId}`, 0.2);
  }
  for (const enemyHeroId of row.state.enemyHeroIds) {
    builder.add(`enemy-item:${enemyHeroId}:${itemId}`, 0.25);
  }

  builder.add('generator-score', bounded(candidate.generatorScore, -10, 10) / 10);
  builder.add('historical-probability', bounded(candidate.historicalProbability, 0, 1));
  builder.add('generator-confidence', bounded(candidate.confidence, 0, 1));
  builder.add('inverse-rank', 1 / Math.max(1, candidate.rank));
  builder.add('log-historical-count', Math.log1p(Math.max(0, candidate.historicalCount)) / 12);
  builder.add('log-cost', Math.log1p(Math.max(0, candidate.cost ?? 0)) / 12);
  builder.add('tier-value', bounded(candidate.tier ?? 0, 0, 4) / 4);
  builder.add('required-components', bounded(candidate.requiredComponentCount, 0, 8) / 8);
  builder.add('owned-components', bounded(candidate.ownedComponentCount, 0, 8) / 8);
  builder.add('missing-components', bounded(candidate.missingComponentCount, 0, 8) / 8);
  builder.add('complete-recipe', candidate.hasCompleteRecipeComponents ? 1 : 0);
  builder.add('already-owned', bounded(candidate.alreadyOwnedCount, 0, 4) / 4);
  builder.add('same-slot-owned', bounded(candidate.sameSlotOwnedItemCount, 0, 8) / 8);
  builder.add('inventory-tag-overlap-count', bounded(candidate.inventoryTagOverlapCount, 0, 16) / 16);
  builder.add('previous-action-count', bounded(candidate.previousActionCount, 0, 4) / 4);
  builder.add('cost-networth-ratio', bounded(candidate.costToNetWorthRatio ?? 0, 0, 2) / 2);

  builder.add(`item-networth:${itemId}`, Math.log1p(Math.max(0, row.state.netWorth ?? 0)) / 12);
  builder.add(`item-kills:${itemId}`, bounded(row.state.kills ?? 0, 0, 30) / 30);
  builder.add(`item-deaths:${itemId}`, bounded(row.state.deaths ?? 0, 0, 30) / 30);
  builder.add(`item-assists:${itemId}`, bounded(row.state.assists ?? 0, 0, 40) / 40);
  builder.add(`item-level:${itemId}`, bounded(row.state.level ?? 0, 0, 30) / 30);
  builder.add(`item-health-ratio:${itemId}`, healthRatio(row));
  builder.add(
    `item-inventory-size:${itemId}`,
    bounded(
      row.state.inventoryItemCounts.reduce((sum, value) => sum + value.count, 0),
      0,
      16,
    ) / 16,
  );

  return builder.values();
}

function sparseFeatureBuilder(hashDimension: number) {
  const features = new Map<number, number>();
  return {
    add(key: string, value = 1): void {
      if (!Number.isFinite(value) || value === 0) {
        return;
      }
      const hash = fnv1a(key);
      const index = hash % hashDimension;
      const sign = (hash & 0x80000000) === 0 ? 1 : -1;
      features.set(index, (features.get(index) ?? 0) + sign * value);
    },
    values(): SparseFeature[] {
      return [...features.entries()]
        .map(([index, value]) => ({ index, value }))
        .filter((feature) => Number.isFinite(feature.value) && feature.value !== 0)
        .sort((left, right) => left.index - right.index);
    },
  };
}

function normalizeSparseFeatures(
  features: readonly SparseFeature[],
): SparseFeature[] {
  const norm = Math.sqrt(
    features.reduce((sum, feature) => sum + feature.value ** 2, 0),
  );
  if (!Number.isFinite(norm) || norm <= 0) {
    return [];
  }
  return features.map((feature) => ({
    index: feature.index,
    value: feature.value / norm,
  }));
}

function towerVector(
  embeddings: readonly number[],
  features: readonly SparseFeature[],
  latentDimension: number,
): number[] {
  const result = Array.from({ length: latentDimension }, () => 0);
  for (const feature of features) {
    const offset = feature.index * latentDimension;
    for (let latentIndex = 0; latentIndex < latentDimension; latentIndex += 1) {
      result[latentIndex] +=
        embeddings[offset + latentIndex] * feature.value;
    }
  }
  return result;
}

function updateEmbeddingFeatures(
  embeddings: number[],
  features: readonly SparseFeature[],
  vectorGradient: readonly number[],
  learningRate: number,
  l2: number,
  latentDimension: number,
): void {
  for (const feature of features) {
    const offset = feature.index * latentDimension;
    for (let latentIndex = 0; latentIndex < latentDimension; latentIndex += 1) {
      const index = offset + latentIndex;
      const weight = embeddings[index];
      const gradient =
        vectorGradient[latentIndex] * feature.value + l2 * weight;
      embeddings[index] = weight - learningRate * gradient;
    }
  }
}

function deterministicCandidateEmbeddingValue(
  offset: number,
  latentDimension: number,
  scale: number,
): number {
  let value = (offset + 1) >>> 0;
  value ^= 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  value ^= value >>> 16;
  const unit = (value >>> 0) / 0xffffffff;
  return ((unit * 2 - 1) * scale) / Math.sqrt(latentDimension);
}

function validateTrainingRow(row: RecommendationProDecisionDatasetV6Row): void {
  validatePredictionRow(row);
  if (!row.eligibility.behavioralModel) {
    throw new Error('Behavioral V5.2 row is not behavior-model eligible.');
  }
  if (!row.observedActionInCandidateSet) {
    throw new Error(
      'Behavioral V5.2 observed action is outside the candidate set.',
    );
  }
}

function validatePredictionRow(row: RecommendationProDecisionDatasetV6Row): void {
  if (!row.decisionId.trim() || !row.matchId.trim()) {
    throw new Error('Behavioral V5.2 row identity is required.');
  }
  if (row.candidates.length < 2) {
    throw new Error('Behavioral V5.2 requires at least two candidates.');
  }
  const actionKeys = new Set<string>();
  for (const candidate of row.candidates) {
    if (!candidate.actionKey.trim() || actionKeys.has(candidate.actionKey)) {
      throw new Error(
        'Behavioral V5.2 candidate action keys must be unique.',
      );
    }
    actionKeys.add(candidate.actionKey);
  }
}

function validateTrainingStepOptions(
  options: RecommendationBehavioralV52TrainingStepOptions,
): void {
  if (
    !Number.isFinite(options.learningRate) ||
    options.learningRate <= 0 ||
    options.learningRate > 10
  ) {
    throw new Error('Behavioral V5.2 learningRate must be in (0, 10].');
  }
  if (!Number.isFinite(options.l2) || options.l2 < 0 || options.l2 > 1) {
    throw new Error('Behavioral V5.2 l2 must be in [0, 1].');
  }
}

function validateModelConfig(config: RecommendationBehavioralV52ModelConfig): void {
  if (
    !Number.isSafeInteger(config.linearHashDimension) ||
    config.linearHashDimension < 256 ||
    config.linearHashDimension > 262_144
  ) {
    throw new Error(
      'Behavioral V5.2 linearHashDimension must be between 256 and 262144.',
    );
  }
  if (
    !Number.isSafeInteger(config.embeddingHashDimension) ||
    config.embeddingHashDimension < 128 ||
    config.embeddingHashDimension > 32_768
  ) {
    throw new Error(
      'Behavioral V5.2 embeddingHashDimension must be between 128 and 32768.',
    );
  }
  if (
    !Number.isSafeInteger(config.latentDimension) ||
    config.latentDimension < 2 ||
    config.latentDimension > 32
  ) {
    throw new Error(
      'Behavioral V5.2 latentDimension must be between 2 and 32.',
    );
  }
}

function dot(weights: readonly number[], features: readonly SparseFeature[]): number {
  return features.reduce(
    (sum, feature) => sum + weights[feature.index] * feature.value,
    0,
  );
}

function denseDot(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new Error('Behavioral V5.2 latent vector dimension mismatch.');
  }
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function softmax(scores: readonly number[]): number[] {
  if (scores.length === 0 || scores.some((score) => !Number.isFinite(score))) {
    throw new Error('Behavioral V5.2 scores must be finite and non-empty.');
  }
  const maximum = Math.max(...scores);
  const exponentials = scores.map((score) => Math.exp(score - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Behavioral V5.2 softmax normalization failed.');
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
