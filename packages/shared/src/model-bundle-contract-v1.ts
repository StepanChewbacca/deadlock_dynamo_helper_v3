export const MODEL_BUNDLE_CONTRACT_VERSION = 'model-bundle-v1' as const;

export type RecommendationModelKind = 'BEHAVIORAL' | 'VALUE' | 'POLICY';
export type ModelGateStatus = 'PASS' | 'FAIL' | 'NOT_EVALUATED';

export interface ModelBundleArtifactFileV1 {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface ModelBundleGateV1 {
  name: string;
  status: ModelGateStatus;
  value?: number | string | boolean;
  threshold?: number | string | boolean;
  evidenceRef?: string;
}

export interface ModelBundleManifestV1 {
  contractVersion: typeof MODEL_BUNDLE_CONTRACT_VERSION;
  modelId: string;
  modelVersion: string;
  modelKind: RecommendationModelKind;
  createdAt: string;
  sourceCommitSha: string;
  datasetId: string;
  datasetSha256: string;
  featureContractVersion: string;
  actionContractVersion: string;
  candidateGeneratorVersion: string;
  supportedRulesetVersions: readonly string[];
  supportedCatalogSha256: readonly string[];
  trainingConfigSha256: string;
  files: readonly ModelBundleArtifactFileV1[];
  gates: readonly ModelBundleGateV1[];
  futureTestEvaluated: boolean;
  notes?: string;
}

export interface ModelBundleRuntimeCompatibilityV1 {
  featureContractVersion: string;
  actionContractVersion: string;
  candidateGeneratorVersion: string;
  rulesetVersion: string;
  catalogSha256: string;
  requiredGateNames: readonly string[];
}

export interface ModelBundleValidationV1 {
  valid: boolean;
  errors: readonly string[];
}

export function validateModelBundleManifestV1(manifest: ModelBundleManifestV1): ModelBundleValidationV1 {
  const errors: string[] = [];
  if (manifest.contractVersion !== MODEL_BUNDLE_CONTRACT_VERSION) errors.push('MODEL_BUNDLE_CONTRACT_MISMATCH');
  if (!manifest.modelId) errors.push('MODEL_ID_REQUIRED');
  if (!manifest.modelVersion) errors.push('MODEL_VERSION_REQUIRED');
  if (!isCommitSha(manifest.sourceCommitSha)) errors.push('SOURCE_COMMIT_SHA_INVALID');
  if (!manifest.datasetId) errors.push('DATASET_ID_REQUIRED');
  if (!isSha256(manifest.datasetSha256)) errors.push('DATASET_SHA256_INVALID');
  if (!isSha256(manifest.trainingConfigSha256)) errors.push('TRAINING_CONFIG_SHA256_INVALID');
  if (!manifest.featureContractVersion) errors.push('FEATURE_CONTRACT_VERSION_REQUIRED');
  if (!manifest.actionContractVersion) errors.push('ACTION_CONTRACT_VERSION_REQUIRED');
  if (!manifest.candidateGeneratorVersion) errors.push('CANDIDATE_GENERATOR_VERSION_REQUIRED');
  if (!isIsoDate(manifest.createdAt)) errors.push('CREATED_AT_INVALID');
  if (manifest.supportedRulesetVersions.length === 0) errors.push('SUPPORTED_RULESET_REQUIRED');
  if (manifest.supportedCatalogSha256.length === 0) errors.push('SUPPORTED_CATALOG_REQUIRED');
  for (const sha of manifest.supportedCatalogSha256) if (!isSha256(sha)) errors.push(`SUPPORTED_CATALOG_SHA_INVALID:${sha}`);

  const filePaths = new Set<string>();
  for (const file of manifest.files) {
    if (!isSafeRelativeArtifactPath(file.path)) errors.push(`UNSAFE_ARTIFACT_PATH:${file.path}`);
    if (filePaths.has(file.path)) errors.push(`DUPLICATE_ARTIFACT_PATH:${file.path}`);
    filePaths.add(file.path);
    if (!isSha256(file.sha256)) errors.push(`ARTIFACT_SHA256_INVALID:${file.path}`);
    if (!Number.isInteger(file.sizeBytes) || file.sizeBytes < 0) errors.push(`ARTIFACT_SIZE_INVALID:${file.path}`);
  }
  if (manifest.files.length === 0) errors.push('MODEL_ARTIFACT_FILES_REQUIRED');

  const gateNames = new Set<string>();
  for (const gate of manifest.gates) {
    if (!gate.name) errors.push('MODEL_GATE_NAME_REQUIRED');
    if (gateNames.has(gate.name)) errors.push(`DUPLICATE_MODEL_GATE:${gate.name}`);
    gateNames.add(gate.name);
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

export function validateModelBundleRuntimeCompatibilityV1(
  manifest: ModelBundleManifestV1,
  runtime: ModelBundleRuntimeCompatibilityV1,
): ModelBundleValidationV1 {
  const errors = [...validateModelBundleManifestV1(manifest).errors];
  if (manifest.featureContractVersion !== runtime.featureContractVersion) errors.push('FEATURE_CONTRACT_INCOMPATIBLE');
  if (manifest.actionContractVersion !== runtime.actionContractVersion) errors.push('ACTION_CONTRACT_INCOMPATIBLE');
  if (manifest.candidateGeneratorVersion !== runtime.candidateGeneratorVersion) errors.push('CANDIDATE_GENERATOR_INCOMPATIBLE');
  if (!manifest.supportedRulesetVersions.includes(runtime.rulesetVersion)) errors.push('RULESET_INCOMPATIBLE');
  if (!manifest.supportedCatalogSha256.includes(runtime.catalogSha256)) errors.push('CATALOG_INCOMPATIBLE');

  const gateByName = new Map(manifest.gates.map((gate) => [gate.name, gate]));
  for (const gateName of runtime.requiredGateNames) {
    const gate = gateByName.get(gateName);
    if (!gate) errors.push(`REQUIRED_GATE_MISSING:${gateName}`);
    else if (gate.status !== 'PASS') errors.push(`REQUIRED_GATE_NOT_PASS:${gateName}:${gate.status}`);
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

export function assertModelBundleRuntimeCompatibleV1(
  manifest: ModelBundleManifestV1,
  runtime: ModelBundleRuntimeCompatibilityV1,
): void {
  const validation = validateModelBundleRuntimeCompatibilityV1(manifest, runtime);
  if (!validation.valid) throw new Error(`Model bundle is not loadable: ${validation.errors.join(',')}`);
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
