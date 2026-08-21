import {
  RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  RecommendationActionFeatureV8,
  RecommendationFeatureStateV8,
  validateRecommendationFeatureStateV8,
} from './recommendation-feature-store-v8';
import { EXACT_ACTION_PROPENSITY_SOURCE } from './off-policy-evaluation-v1';

export const RECOMMENDATION_VALUE_TRAINING_EXAMPLE_V1 = 'recommendation-value-training-example-v1' as const;
export const RECOMMENDATION_VALUE_DATASET_MANIFEST_V1 = 'recommendation-value-dataset-manifest-v1' as const;

export type RecommendationValueTrainingSplitV1 = 'TRAIN' | 'VALIDATION' | 'SHADOW_HOLDOUT';

export interface RecommendationValueTrainingExampleV1 {
  contractVersion: typeof RECOMMENDATION_VALUE_TRAINING_EXAMPLE_V1;
  split: RecommendationValueTrainingSplitV1;
  decisionId: string;
  matchId: string;
  candidateGeneratorVersion: string;
  state: RecommendationFeatureStateV8;
  candidates: readonly RecommendationActionFeatureV8[];
  loggedActionKey: string;
  reward: number;
  actionLoggingPropensity: number;
  actionLoggingPropensitySource: typeof EXACT_ACTION_PROPENSITY_SOURCE;
  randomized: true;
}

export interface RecommendationValueDatasetSplitV1 {
  split: RecommendationValueTrainingSplitV1;
  from: string;
  to: string;
  matchCount: number;
  decisionCount: number;
  matchSetSha256: string;
}

export interface RecommendationValueDatasetFileV1 {
  path: string;
  sha256: string;
  sizeBytes: number;
  rowCount: number;
}

export interface RecommendationValueDatasetManifestV1 {
  contractVersion: typeof RECOMMENDATION_VALUE_DATASET_MANIFEST_V1;
  datasetId: string;
  datasetSha256: string;
  createdAt: string;
  sourceCommitSha: string;
  reward: string;
  featureContractVersion: typeof RECOMMENDATION_FEATURE_CONTRACT_VERSION;
  actionContractVersion: string;
  candidateGeneratorVersion: string;
  pointInTimeCorrect: true;
  randomizedOnly: true;
  exactActionPropensityOnly: true;
  futureTestEvaluated: false;
  splits: readonly RecommendationValueDatasetSplitV1[];
  files: readonly RecommendationValueDatasetFileV1[];
}

export function validateRecommendationValueTrainingExampleV1(
  example: RecommendationValueTrainingExampleV1,
): readonly string[] {
  const errors: string[] = [];
  if (example.contractVersion !== RECOMMENDATION_VALUE_TRAINING_EXAMPLE_V1) errors.push('VALUE_EXAMPLE_CONTRACT_MISMATCH');
  if (!['TRAIN', 'VALIDATION', 'SHADOW_HOLDOUT'].includes(example.split)) errors.push('VALUE_SPLIT_INVALID');
  if (!example.decisionId) errors.push('DECISION_ID_REQUIRED');
  if (!example.matchId) errors.push('MATCH_ID_REQUIRED');
  if (!example.candidateGeneratorVersion) errors.push('CANDIDATE_GENERATOR_VERSION_REQUIRED');
  if (!Number.isFinite(example.reward)) errors.push('REWARD_INVALID');
  if (example.randomized !== true) errors.push('RANDOMIZED_DECISION_REQUIRED');
  if (example.actionLoggingPropensitySource !== EXACT_ACTION_PROPENSITY_SOURCE) {
    errors.push('EXACT_ACTION_PROPENSITY_REQUIRED');
  }
  if (!Number.isFinite(example.actionLoggingPropensity) || example.actionLoggingPropensity <= 0 || example.actionLoggingPropensity > 1) {
    errors.push('ACTION_LOGGING_PROPENSITY_INVALID');
  }
  const state = validateRecommendationFeatureStateV8(example.state);
  for (const error of state.errors) errors.push(`STATE:${error}`);
  if (example.state.decisionId !== example.decisionId) errors.push('STATE_DECISION_ID_MISMATCH');
  if (example.state.matchId !== example.matchId) errors.push('STATE_MATCH_ID_MISMATCH');
  if (example.candidates.length === 0) errors.push('FEASIBLE_CHOICE_SET_EMPTY');
  const keys = new Set<string>();
  for (const candidate of example.candidates) {
    if (!candidate.actionKey) errors.push('CANDIDATE_ACTION_KEY_REQUIRED');
    if (keys.has(candidate.actionKey)) errors.push(`DUPLICATE_CANDIDATE:${candidate.actionKey}`);
    keys.add(candidate.actionKey);
    if (!Number.isFinite(candidate.effectiveCostSouls)) errors.push(`CANDIDATE_COST_INVALID:${candidate.actionKey}`);
  }
  if (!example.loggedActionKey) errors.push('LOGGED_ACTION_REQUIRED');
  else if (!keys.has(example.loggedActionKey)) errors.push('LOGGED_ACTION_OUTSIDE_FEASIBLE_SET');
  return [...new Set(errors)].sort();
}

export function validateRecommendationValueDatasetManifestV1(
  manifest: RecommendationValueDatasetManifestV1,
): readonly string[] {
  const errors: string[] = [];
  if (manifest.contractVersion !== RECOMMENDATION_VALUE_DATASET_MANIFEST_V1) errors.push('VALUE_DATASET_CONTRACT_MISMATCH');
  if (!manifest.datasetId) errors.push('DATASET_ID_REQUIRED');
  if (!isSha256(manifest.datasetSha256)) errors.push('DATASET_SHA256_INVALID');
  if (!isCommitSha(manifest.sourceCommitSha)) errors.push('SOURCE_COMMIT_SHA_INVALID');
  if (!Number.isFinite(Date.parse(manifest.createdAt))) errors.push('CREATED_AT_INVALID');
  if (!manifest.reward) errors.push('REWARD_REQUIRED');
  if (manifest.featureContractVersion !== RECOMMENDATION_FEATURE_CONTRACT_VERSION) errors.push('FEATURE_CONTRACT_MISMATCH');
  if (!manifest.actionContractVersion) errors.push('ACTION_CONTRACT_REQUIRED');
  if (!manifest.candidateGeneratorVersion) errors.push('CANDIDATE_GENERATOR_VERSION_REQUIRED');
  if (manifest.pointInTimeCorrect !== true) errors.push('POINT_IN_TIME_CORRECTNESS_REQUIRED');
  if (manifest.randomizedOnly !== true) errors.push('RANDOMIZED_ONLY_REQUIRED');
  if (manifest.exactActionPropensityOnly !== true) errors.push('EXACT_ACTION_PROPENSITY_ONLY_REQUIRED');
  if (manifest.futureTestEvaluated !== false) errors.push('FUTURE_TEST_MUST_REMAIN_UNEVALUATED');

  const expectedSplits: RecommendationValueTrainingSplitV1[] = ['TRAIN', 'VALIDATION', 'SHADOW_HOLDOUT'];
  if (manifest.splits.length !== expectedSplits.length) errors.push('VALUE_SPLIT_COUNT_INVALID');
  let previousTo = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < manifest.splits.length; index += 1) {
    const split = manifest.splits[index];
    if (split.split !== expectedSplits[index]) errors.push(`VALUE_SPLIT_ORDER_INVALID:${split.split}`);
    const from = Date.parse(split.from);
    const to = Date.parse(split.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) errors.push(`VALUE_SPLIT_RANGE_INVALID:${split.split}`);
    if (from < previousTo) errors.push(`VALUE_SPLIT_OVERLAP:${split.split}`);
    previousTo = to;
    if (!Number.isInteger(split.matchCount) || split.matchCount < 0) errors.push(`VALUE_MATCH_COUNT_INVALID:${split.split}`);
    if (!Number.isInteger(split.decisionCount) || split.decisionCount < 0) errors.push(`VALUE_DECISION_COUNT_INVALID:${split.split}`);
    if (!isSha256(split.matchSetSha256)) errors.push(`VALUE_MATCH_SET_SHA_INVALID:${split.split}`);
  }

  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (!safeRelativePath(file.path)) errors.push(`VALUE_FILE_PATH_INVALID:${file.path}`);
    if (seen.has(file.path)) errors.push(`VALUE_FILE_DUPLICATE:${file.path}`);
    seen.add(file.path);
    if (!isSha256(file.sha256)) errors.push(`VALUE_FILE_SHA_INVALID:${file.path}`);
    if (!Number.isInteger(file.sizeBytes) || file.sizeBytes < 0) errors.push(`VALUE_FILE_SIZE_INVALID:${file.path}`);
    if (!Number.isInteger(file.rowCount) || file.rowCount < 0) errors.push(`VALUE_FILE_ROW_COUNT_INVALID:${file.path}`);
    if (/future[_-]?test/i.test(file.path)) errors.push(`FUTURE_TEST_ARTIFACT_FORBIDDEN:${file.path}`);
  }
  for (const split of expectedSplits) {
    const suffix = `${split.toLowerCase()}.jsonl.gz`;
    if (manifest.files.filter((file) => file.path.replace(/\\/g, '/').endsWith(suffix)).length !== 1) {
      errors.push(`VALUE_SPLIT_FILE_COUNT_INVALID:${split}`);
    }
  }
  return [...new Set(errors)].sort();
}

function safeRelativePath(value: string): boolean {
  if (!value || value.startsWith('/') || value.startsWith('\\')) return false;
  const normalized = value.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split('/').some((part) => !part || part === '..');
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isCommitSha(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}
