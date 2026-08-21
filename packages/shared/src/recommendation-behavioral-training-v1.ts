import { RecommendationDatasetManifestV1, validateRecommendationDatasetManifestV1 } from './recommendation-dataset-manifest-v1';
import {
  RecommendationBehavioralV8Candidate,
  RecommendationBehavioralV8ModelFamily,
} from './recommendation-behavioral-v8';
import {
  RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  RecommendationFeatureStateV8,
  validateRecommendationFeatureStateV8,
} from './recommendation-feature-store-v8';
import {
  RecommendationRoadmapEvidenceV1,
  evaluateRecommendationRoadmapStateV1,
} from './recommendation-roadmap-state-v1';

export const RECOMMENDATION_BEHAVIORAL_TRAINING_EXAMPLE_V1 = 'recommendation-behavioral-training-example-v1' as const;
export const RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1 = 'recommendation-behavioral-training-launch-v1' as const;

export type RecommendationBehavioralTrainingSplitV1 = 'TRAIN' | 'VALIDATION' | 'SHADOW_HOLDOUT' | 'FUTURE_TEST';
export type RecommendationBehavioralTrainableFamilyV1 = Extract<
  RecommendationBehavioralV8ModelFamily,
  'SEQUENCE_RNN' | 'SEQUENCE_TRANSFORMER'
>;

export interface RecommendationBehavioralTrainingExampleV1 {
  contractVersion: typeof RECOMMENDATION_BEHAVIORAL_TRAINING_EXAMPLE_V1;
  split: RecommendationBehavioralTrainingSplitV1;
  decisionId: string;
  matchId: string;
  candidateGeneratorVersion: string;
  state: RecommendationFeatureStateV8;
  candidates: readonly RecommendationBehavioralV8Candidate[];
  observedActionKey: string;
  observedActionInjected: false;
  actionLoggingPropensity?: number;
  actionLoggingPropensitySource?: 'RECORDED_AT_ACTION_SELECTION' | 'RECONSTRUCTED';
}

export interface RecommendationBehavioralTrainingConfigV1 {
  contractVersion: typeof RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1;
  family: RecommendationBehavioralTrainableFamilyV1;
  seed: number;
  deterministic: true;
  trainSplit: 'TRAIN';
  validationSplit: 'VALIDATION';
  selectionSplit: 'SHADOW_HOLDOUT';
  futureTestAllowed: false;
  maxEpochs: number;
  batchSize: number;
  learningRate: number;
  weightDecay: number;
  gradientClip: number;
  maximumHistoryEvents: number;
  embeddingDimension: number;
  hiddenDimension: number;
  layerCount: number;
  attentionHeads?: number;
  earlyStoppingPatience: number;
}

export interface RecommendationBehavioralTrainingLaunchInputV1 {
  manifest: RecommendationDatasetManifestV1;
  evidence: RecommendationRoadmapEvidenceV1;
  config: RecommendationBehavioralTrainingConfigV1;
}

export interface RecommendationBehavioralTrainingLaunchReportV1 {
  contractVersion: typeof RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1;
  ready: boolean;
  blockers: readonly string[];
  datasetId: string;
  datasetSha256: string;
  family: RecommendationBehavioralTrainableFamilyV1;
}

export function validateRecommendationBehavioralTrainingExampleV1(
  example: RecommendationBehavioralTrainingExampleV1,
): readonly string[] {
  const errors: string[] = [];
  if (example.contractVersion !== RECOMMENDATION_BEHAVIORAL_TRAINING_EXAMPLE_V1) errors.push('TRAINING_EXAMPLE_CONTRACT_MISMATCH');
  if (!example.decisionId) errors.push('DECISION_ID_REQUIRED');
  if (!example.matchId) errors.push('MATCH_ID_REQUIRED');
  if (!example.candidateGeneratorVersion) errors.push('CANDIDATE_GENERATOR_VERSION_REQUIRED');
  if (example.observedActionInjected !== false) errors.push('OBSERVED_ACTION_INJECTION_FORBIDDEN');
  if (!['TRAIN', 'VALIDATION', 'SHADOW_HOLDOUT', 'FUTURE_TEST'].includes(example.split)) errors.push('TRAINING_SPLIT_INVALID');

  const stateValidation = validateRecommendationFeatureStateV8(example.state);
  for (const error of stateValidation.errors) errors.push(`STATE:${error}`);
  if (example.state.contractVersion !== RECOMMENDATION_FEATURE_CONTRACT_VERSION) errors.push('FEATURE_CONTRACT_MISMATCH');
  if (example.state.decisionId !== example.decisionId) errors.push('STATE_DECISION_ID_MISMATCH');
  if (example.state.matchId !== example.matchId) errors.push('STATE_MATCH_ID_MISMATCH');

  if (example.candidates.length === 0) errors.push('FEASIBLE_CHOICE_SET_EMPTY');
  const keys = new Set<string>();
  for (const candidate of example.candidates) {
    if (candidate.feasible !== true) errors.push(`NON_FEASIBLE_CANDIDATE:${candidate.actionKey}`);
    if (!candidate.actionKey) errors.push('CANDIDATE_ACTION_KEY_REQUIRED');
    if (keys.has(candidate.actionKey)) errors.push(`DUPLICATE_CANDIDATE:${candidate.actionKey}`);
    keys.add(candidate.actionKey);
  }
  if (!example.observedActionKey) errors.push('OBSERVED_ACTION_REQUIRED');
  else if (!keys.has(example.observedActionKey)) errors.push('OBSERVED_ACTION_OUTSIDE_FEASIBLE_SET');

  if (example.actionLoggingPropensity !== undefined) {
    if (!Number.isFinite(example.actionLoggingPropensity) || example.actionLoggingPropensity <= 0 || example.actionLoggingPropensity > 1) {
      errors.push('ACTION_LOGGING_PROPENSITY_INVALID');
    }
    if (!example.actionLoggingPropensitySource) errors.push('ACTION_LOGGING_PROPENSITY_SOURCE_REQUIRED');
  } else if (example.actionLoggingPropensitySource) {
    errors.push('ACTION_LOGGING_PROPENSITY_REQUIRED');
  }

  return [...new Set(errors)].sort();
}

export function evaluateRecommendationBehavioralTrainingLaunchV1(
  input: RecommendationBehavioralTrainingLaunchInputV1,
): RecommendationBehavioralTrainingLaunchReportV1 {
  const blockers: string[] = [];
  const manifestValidation = validateRecommendationDatasetManifestV1(input.manifest);
  for (const error of manifestValidation.errors) blockers.push(`DATASET_MANIFEST:${error}`);
  const configErrors = validateTrainingConfig(input.config);
  blockers.push(...configErrors);

  const roadmap = evaluateRecommendationRoadmapStateV1(input.evidence);
  const prospectiveData = roadmap.phases.find((phase) => phase.phase === 'PROSPECTIVE_DATA');
  if (!prospectiveData?.unlocked) {
    blockers.push(...(prospectiveData?.blockers.map((blocker) => `PROSPECTIVE_DATA:${blocker}`) ?? ['PROSPECTIVE_DATA:PHASE_NOT_FOUND']));
  }
  if (!input.evidence.futureTestUntouched) blockers.push('FUTURE_TEST_INTEGRITY_VIOLATION');
  if ((input.evidence.futureTestEvaluation ?? 'NOT_EVALUATED') !== 'NOT_EVALUATED') blockers.push('FUTURE_TEST_ALREADY_EVALUATED');
  if (input.manifest.futureTestTouched) blockers.push('DATASET_FUTURE_TEST_ALREADY_TOUCHED');

  return {
    contractVersion: RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1,
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
    datasetId: input.manifest.datasetId,
    datasetSha256: input.manifest.datasetSha256,
    family: input.config.family,
  };
}

export function assertRecommendationBehavioralTrainingLaunchReadyV1(
  input: RecommendationBehavioralTrainingLaunchInputV1,
): void {
  const report = evaluateRecommendationBehavioralTrainingLaunchV1(input);
  if (!report.ready) throw new Error(`Behavioral V8 training launch is blocked: ${report.blockers.join(',')}`);
}

function validateTrainingConfig(config: RecommendationBehavioralTrainingConfigV1): string[] {
  const errors: string[] = [];
  if (config.contractVersion !== RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1) errors.push('TRAINING_CONFIG_CONTRACT_MISMATCH');
  if (config.family !== 'SEQUENCE_RNN' && config.family !== 'SEQUENCE_TRANSFORMER') errors.push('TRAINING_FAMILY_INVALID');
  if (!Number.isInteger(config.seed) || config.seed < 0) errors.push('SEED_INVALID');
  if (config.deterministic !== true) errors.push('DETERMINISTIC_TRAINING_REQUIRED');
  if (config.trainSplit !== 'TRAIN') errors.push('TRAIN_SPLIT_MUST_BE_TRAIN');
  if (config.validationSplit !== 'VALIDATION') errors.push('VALIDATION_SPLIT_MUST_BE_VALIDATION');
  if (config.selectionSplit !== 'SHADOW_HOLDOUT') errors.push('SELECTION_SPLIT_MUST_BE_SHADOW_HOLDOUT');
  if (config.futureTestAllowed !== false) errors.push('FUTURE_TEST_MUST_BE_BLOCKED');
  positiveInteger('MAX_EPOCHS', config.maxEpochs, errors);
  positiveInteger('BATCH_SIZE', config.batchSize, errors);
  positiveNumber('LEARNING_RATE', config.learningRate, errors);
  nonNegativeNumber('WEIGHT_DECAY', config.weightDecay, errors);
  positiveNumber('GRADIENT_CLIP', config.gradientClip, errors);
  nonNegativeInteger('MAXIMUM_HISTORY_EVENTS', config.maximumHistoryEvents, errors);
  positiveInteger('EMBEDDING_DIMENSION', config.embeddingDimension, errors);
  positiveInteger('HIDDEN_DIMENSION', config.hiddenDimension, errors);
  positiveInteger('LAYER_COUNT', config.layerCount, errors);
  positiveInteger('EARLY_STOPPING_PATIENCE', config.earlyStoppingPatience, errors);
  if (config.family === 'SEQUENCE_TRANSFORMER') {
    if (!Number.isInteger(config.attentionHeads) || (config.attentionHeads ?? 0) <= 0) errors.push('ATTENTION_HEADS_REQUIRED');
    else if (config.hiddenDimension % (config.attentionHeads as number) !== 0) errors.push('HIDDEN_DIMENSION_NOT_DIVISIBLE_BY_ATTENTION_HEADS');
  }
  return [...new Set(errors)].sort();
}

function positiveInteger(name: string, value: number, errors: string[]): void {
  if (!Number.isInteger(value) || value <= 0) errors.push(`${name}_INVALID`);
}

function nonNegativeInteger(name: string, value: number, errors: string[]): void {
  if (!Number.isInteger(value) || value < 0) errors.push(`${name}_INVALID`);
}

function positiveNumber(name: string, value: number, errors: string[]): void {
  if (!Number.isFinite(value) || value <= 0) errors.push(`${name}_INVALID`);
}

function nonNegativeNumber(name: string, value: number, errors: string[]): void {
  if (!Number.isFinite(value) || value < 0) errors.push(`${name}_INVALID`);
}
