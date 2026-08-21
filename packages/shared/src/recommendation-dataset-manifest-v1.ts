export const RECOMMENDATION_DATASET_MANIFEST_VERSION = 'recommendation-dataset-manifest-v1' as const;

export type RecommendationDatasetSplitV1 =
  | 'TRAIN'
  | 'VALIDATION'
  | 'SHADOW_HOLDOUT'
  | 'FUTURE_TEST';

export interface RecommendationDatasetArtifactFileV1 {
  path: string;
  sha256: string;
  sizeBytes: number;
  rowCount: number;
}

export interface RecommendationDatasetSplitDescriptorV1 {
  split: RecommendationDatasetSplitV1;
  from: string;
  to: string;
  matchCount: number;
  decisionCount: number;
  matchSetSha256: string;
}

export interface RecommendationDatasetManifestV1 {
  contractVersion: typeof RECOMMENDATION_DATASET_MANIFEST_VERSION;
  datasetId: string;
  datasetSha256: string;
  createdAt: string;
  sourceCommitSha: string;
  datasetContractVersion: string;
  featureContractVersion: string;
  actionContractVersion: string;
  candidateGeneratorVersion: string;
  pointInTimeCorrect: boolean;
  observedActionInjected: boolean;
  futureTestTouched: boolean;
  supportedRulesetVersions: readonly string[];
  supportedCatalogSha256: readonly string[];
  splits: readonly RecommendationDatasetSplitDescriptorV1[];
  files: readonly RecommendationDatasetArtifactFileV1[];
}

export interface RecommendationDatasetManifestValidationV1 {
  valid: boolean;
  errors: readonly string[];
}

const REQUIRED_SPLITS: readonly RecommendationDatasetSplitV1[] = [
  'TRAIN',
  'VALIDATION',
  'SHADOW_HOLDOUT',
  'FUTURE_TEST',
];

export function validateRecommendationDatasetManifestV1(
  manifest: RecommendationDatasetManifestV1,
): RecommendationDatasetManifestValidationV1 {
  const errors: string[] = [];
  if (manifest.contractVersion !== RECOMMENDATION_DATASET_MANIFEST_VERSION) errors.push('DATASET_MANIFEST_CONTRACT_MISMATCH');
  if (!manifest.datasetId) errors.push('DATASET_ID_REQUIRED');
  if (!isSha256(manifest.datasetSha256)) errors.push('DATASET_SHA256_INVALID');
  if (!isCommitSha(manifest.sourceCommitSha)) errors.push('SOURCE_COMMIT_SHA_INVALID');
  if (!isIsoDate(manifest.createdAt)) errors.push('CREATED_AT_INVALID');
  if (!manifest.datasetContractVersion) errors.push('DATASET_CONTRACT_VERSION_REQUIRED');
  if (!manifest.featureContractVersion) errors.push('FEATURE_CONTRACT_VERSION_REQUIRED');
  if (!manifest.actionContractVersion) errors.push('ACTION_CONTRACT_VERSION_REQUIRED');
  if (!manifest.candidateGeneratorVersion) errors.push('CANDIDATE_GENERATOR_VERSION_REQUIRED');
  if (!manifest.pointInTimeCorrect) errors.push('POINT_IN_TIME_CORRECTNESS_REQUIRED');
  if (manifest.observedActionInjected) errors.push('OBSERVED_ACTION_INJECTION_FORBIDDEN');
  if (manifest.futureTestTouched) errors.push('FUTURE_TEST_ALREADY_TOUCHED');
  if (manifest.supportedRulesetVersions.length === 0) errors.push('SUPPORTED_RULESET_REQUIRED');
  if (manifest.supportedCatalogSha256.length === 0) errors.push('SUPPORTED_CATALOG_REQUIRED');
  for (const sha of manifest.supportedCatalogSha256) {
    if (!isSha256(sha)) errors.push(`SUPPORTED_CATALOG_SHA_INVALID:${sha}`);
  }

  const splitByName = new Map<RecommendationDatasetSplitV1, RecommendationDatasetSplitDescriptorV1>();
  for (const split of manifest.splits) {
    if (splitByName.has(split.split)) errors.push(`DUPLICATE_SPLIT:${split.split}`);
    splitByName.set(split.split, split);
    if (!isIsoDate(split.from) || !isIsoDate(split.to)) errors.push(`SPLIT_TIME_INVALID:${split.split}`);
    else if (Date.parse(split.from) >= Date.parse(split.to)) errors.push(`SPLIT_RANGE_INVALID:${split.split}`);
    if (!Number.isInteger(split.matchCount) || split.matchCount < 0) errors.push(`SPLIT_MATCH_COUNT_INVALID:${split.split}`);
    if (!Number.isInteger(split.decisionCount) || split.decisionCount < 0) errors.push(`SPLIT_DECISION_COUNT_INVALID:${split.split}`);
    if (!isSha256(split.matchSetSha256)) errors.push(`SPLIT_MATCH_SET_SHA_INVALID:${split.split}`);
  }
  for (const split of REQUIRED_SPLITS) {
    if (!splitByName.has(split)) errors.push(`REQUIRED_SPLIT_MISSING:${split}`);
  }
  assertChronologicalOrder(splitByName, errors);

  const filePaths = new Set<string>();
  for (const file of manifest.files) {
    if (!isSafeRelativeArtifactPath(file.path)) errors.push(`UNSAFE_DATASET_ARTIFACT_PATH:${file.path}`);
    if (filePaths.has(file.path)) errors.push(`DUPLICATE_DATASET_ARTIFACT_PATH:${file.path}`);
    filePaths.add(file.path);
    if (!isSha256(file.sha256)) errors.push(`DATASET_ARTIFACT_SHA_INVALID:${file.path}`);
    if (!Number.isInteger(file.sizeBytes) || file.sizeBytes < 0) errors.push(`DATASET_ARTIFACT_SIZE_INVALID:${file.path}`);
    if (!Number.isInteger(file.rowCount) || file.rowCount < 0) errors.push(`DATASET_ARTIFACT_ROW_COUNT_INVALID:${file.path}`);
  }
  if (manifest.files.length === 0) errors.push('DATASET_ARTIFACT_FILES_REQUIRED');

  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

export function assertRecommendationDatasetManifestV1(manifest: RecommendationDatasetManifestV1): void {
  const validation = validateRecommendationDatasetManifestV1(manifest);
  if (!validation.valid) throw new Error(`Dataset manifest is invalid: ${validation.errors.join(',')}`);
}

function assertChronologicalOrder(
  splitByName: ReadonlyMap<RecommendationDatasetSplitV1, RecommendationDatasetSplitDescriptorV1>,
  errors: string[],
): void {
  for (let index = 1; index < REQUIRED_SPLITS.length; index += 1) {
    const previousName = REQUIRED_SPLITS[index - 1];
    const currentName = REQUIRED_SPLITS[index];
    const previous = splitByName.get(previousName);
    const current = splitByName.get(currentName);
    if (!previous || !current || !isIsoDate(previous.to) || !isIsoDate(current.from)) continue;
    if (Date.parse(previous.to) > Date.parse(current.from)) {
      errors.push(`SPLIT_CHRONOLOGY_VIOLATION:${previousName}->${currentName}`);
    }
  }
}

function isSafeRelativeArtifactPath(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('\\')) return false;
  const normalized = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return false;
  const parts = normalized.split('/');
  return !parts.some((part) => part === '..' || part === '');
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isCommitSha(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

function isIsoDate(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
