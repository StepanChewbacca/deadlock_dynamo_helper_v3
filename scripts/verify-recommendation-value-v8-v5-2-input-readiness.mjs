import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { join } from 'node:path';

const V52_SCHEMA_VERSION = 1;
const V52_MODEL_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V5_2_LOW_RANK_TWO_TOWER_1_RAW_PROPENSITY';
const V52_FEATURE_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V5_2_FEATURES_1_TWO_TOWER';
const DATASET_SHA =
  'e8b11e26df37ff1e17b334eda18ea2141cfb7fa78f0a34eaf95d448c22962235';

const requestPath = requiredString('VALUE_V8_V5_2_INPUT_READINESS_REQUEST_PATH');
const datasetDirectory = requiredString(
  'DEADLOCK_RECOMMENDATION_VALUE_V8_DATASET_DIR',
);
const behavioralDirectory = requiredString(
  'DEADLOCK_RECOMMENDATION_VALUE_V8_BEHAVIORAL_DIR',
);
const reportPath = requiredString('VALUE_V8_V5_2_INPUT_READINESS_REPORT_PATH');

const request = JSON.parse(await readFile(requestPath, 'utf8'));
validateRequest(request);

const datasetManifest = JSON.parse(
  await readFile(join(datasetDirectory, 'manifest.json'), 'utf8'),
);
const datasetAudit = JSON.parse(
  await readFile(join(datasetDirectory, 'audit.json'), 'utf8'),
);
if (
  datasetManifest.auditPassed !== true ||
  datasetManifest.trainingArtifactEligible !== true ||
  datasetAudit.passed !== true ||
  datasetAudit.trainingArtifactEligible !== true
) {
  throw new Error('Dataset V6 is not eligible for Value V8 readiness.');
}
const datasetPath = join(datasetDirectory, datasetManifest.artifact.fileName);
const datasetSha256 = await hashFile(datasetPath);
assertEqual(datasetSha256, DATASET_SHA, 'Dataset V6 SHA-256');
assertEqual(
  datasetManifest.artifact.sha256,
  DATASET_SHA,
  'Dataset V6 manifest SHA-256',
);

const manifestPath = join(behavioralDirectory, 'manifest.json');
const auditPath = join(behavioralDirectory, 'audit.json');
const evaluationPath = join(behavioralDirectory, 'evaluation.json');
const modelPath = join(behavioralDirectory, 'model.json');
const manifestRaw = await readFile(manifestPath);
const manifest = JSON.parse(manifestRaw.toString('utf8'));
const audit = JSON.parse(await readFile(auditPath, 'utf8'));
const evaluation = JSON.parse(await readFile(evaluationPath, 'utf8'));

const checks = {
  schemaVersion: manifest.schemaVersion === V52_SCHEMA_VERSION,
  modelVersion: manifest.modelVersion === V52_MODEL_VERSION,
  featureVersion: manifest.featureVersion === V52_FEATURE_VERSION,
  manifestAuditPassed: manifest.auditPassed === true,
  manifestReleaseGatePassed: manifest.releaseGatePassed === true,
  manifestTrainingArtifactEligible: manifest.trainingArtifactEligible === true,
  fullCorpus:
    manifest.build?.fullCorpus === true || audit.build?.fullCorpus === true,
  auditPassed: audit.passed === true,
  auditTrainingArtifactEligible: audit.trainingArtifactEligible === true,
  evaluationReleaseGatePassed: evaluation.releaseGate?.passed === true,
  candidateCoverage: evaluation.releaseGate?.candidateCoverage >= 0.99,
  behaviorSupportCoverage:
    evaluation.releaseGate?.behaviorSupportCoverage >= 0.9,
  noMajorLowSupportGroups:
    Array.isArray(evaluation.releaseGate?.majorLowSupportGroups) &&
    evaluation.releaseGate.majorLowSupportGroups.length === 0,
  extremeCandidateProbabilityRate:
    evaluation.releaseGate?.extremeCandidateProbabilityRate <= 0.01,
  floorSensitivity:
    evaluation.releaseGate?.probabilityFloorMaximumLogLossDelta <= 0.02,
  rawPropensityOutput:
    manifest.trainingContract?.propensityOutput ===
    'RAW_SOFTMAX_WITHIN_DECISION',
  noCandidateProbabilityFloor:
    manifest.trainingContract?.candidateProbabilityFloorApplied === false,
  noBehavioralIpsClipping:
    manifest.trainingContract?.ipsClippingApplied === false,
  observedOnlyFloorSensitivity:
    manifest.trainingContract?.probabilityFloorSensitivity ===
    'OBSERVED_PROPENSITY_CLIP_ONLY',
  futureNotTraining:
    manifest.trainingContract?.futureTestUsedForTraining === false,
  futureNotSelection:
    manifest.trainingContract?.futureTestUsedForSelection === false,
  sourceDatasetSha:
    manifest.source?.sha256 === DATASET_SHA ||
    manifest.sourceDatasetSha256 === DATASET_SHA,
};

const propensityDescriptor = manifest.artifacts?.propensities;
if (!propensityDescriptor?.fileName || !propensityDescriptor?.sha256) {
  throw new Error('Behavioral V5.2 propensity artifact descriptor is missing.');
}
const propensityPath = join(behavioralDirectory, propensityDescriptor.fileName);
const propensitySha256 = await hashFile(propensityPath);
assertEqual(
  propensitySha256,
  propensityDescriptor.sha256,
  'Behavioral propensity SHA-256',
);
const propensityAudit = await auditPropensities(propensityPath);
checks.propensityRowsValid = propensityAudit.invalidRowCount === 0;

const hashes = {
  datasetSha256,
  behavioralManifestSha256: sha256(manifestRaw),
  behavioralModelSha256: await hashFile(modelPath),
  behavioralPropensitySha256: propensitySha256,
  behavioralEvaluationSha256: await hashFile(evaluationPath),
  behavioralAuditSha256: await hashFile(auditPath),
};
const valueInputReady = Object.values(checks).every(Boolean);
const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_VALUE_V8_V5_2_INPUT_READINESS',
  generatedAt: new Date().toISOString(),
  behavioralContract: {
    schemaVersion: V52_SCHEMA_VERSION,
    modelVersion: V52_MODEL_VERSION,
    featureVersion: V52_FEATURE_VERSION,
    probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
  },
  checks,
  hashes,
  propensityAudit,
  valueInputReady,
  standaloneValueV52ExecutorPrepared: true,
  legacyValueServiceV51LoaderBypassed: true,
  preparedExecutor: 'scripts/run-recommendation-value-v8-bounded-v5-2.mjs',
  recommendedDiagnosticMaxRows: 50_000,
  maximumTrainingMinutes: 20,
  valueV8TrainingAuthorized: false,
  fullValueV8TrainingAuthorized: false,
  offlineVerificationAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};
await writeFile(reportPath, `${JSON.stringify(report, undefined, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!valueInputReady) {
  throw new Error(
    `Value V8 V5.2 input readiness failed: ${Object.entries(checks)
      .filter(([, passed]) => passed !== true)
      .map(([name]) => name)
      .join(', ')}.`,
  );
}

async function auditPropensities(path) {
  const raw = createReadStream(path);
  const input = path.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  const lines = createInterface({ input, crlfDelay: Infinity });
  let rowCount = 0;
  let invalidRowCount = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    rowCount += 1;
    try {
      const row = JSON.parse(line);
      const total = Array.isArray(row.candidates)
        ? row.candidates.reduce(
            (sum, candidate) => sum + Number(candidate.probability),
            0,
          )
        : Number.NaN;
      if (
        row.schemaVersion !== V52_SCHEMA_VERSION ||
        row.modelVersion !== V52_MODEL_VERSION ||
        row.featureVersion !== V52_FEATURE_VERSION ||
        row.probabilityContract !== 'RAW_SOFTMAX_WITHIN_DECISION' ||
        row.propensityFloorApplied !== false ||
        row.observedActionProbability !== row.observedActionRawProbability ||
        !Array.isArray(row.candidates) ||
        row.candidates.length < 2 ||
        row.candidates.some(
          (candidate) =>
            !Number.isFinite(candidate.probability) ||
            candidate.probability <= 0 ||
            candidate.probability !== candidate.rawProbability,
        ) ||
        !Number.isFinite(total) ||
        Math.abs(total - 1) > 1e-9
      ) {
        invalidRowCount += 1;
      }
    } catch {
      invalidRowCount += 1;
    }
  }
  if (rowCount === 0) {
    throw new Error('Behavioral V5.2 propensity artifact is empty.');
  }
  return { rowCount, invalidRowCount };
}

function validateRequest(value) {
  if (
    value?.schemaVersion !== 1 ||
    value?.operation !== 'RECOMMENDATION_VALUE_V8_V5_2_INPUT_READINESS' ||
    value?.readinessAuthorized !== true ||
    value?.valueV8TrainingAuthorized !== false ||
    value?.fullValueV8TrainingAuthorized !== false ||
    value?.productionRankingChanged !== false ||
    value?.passiveShadowAuthorized !== false ||
    value?.randomizedCanaryAuthorized !== false
  ) {
    throw new Error('Invalid Value V8 V5.2 input-readiness request.');
  }
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function requiredString(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}
