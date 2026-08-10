import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const requestPath = requiredString('BEHAVIORAL_V5_2_FULL_READINESS_REQUEST_PATH');
const datasetDirectory = requiredString('DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_2_SOURCE_DIR');
const refinementSummaryPath = requiredString('BEHAVIORAL_V5_2_REFINEMENT_SUMMARY_PATH');
const reportPath = requiredString('BEHAVIORAL_V5_2_FULL_READINESS_REPORT_PATH');
const expectedDatasetSha256 = requiredSha256('EXPECTED_DATASET_SHA256');
const expectedRefinementSummarySha256 = requiredSha256('EXPECTED_REFINEMENT_SUMMARY_SHA256');

const request = JSON.parse(await readFile(requestPath, 'utf8'));
validateRequest(request);

const manifest = JSON.parse(await readFile(join(datasetDirectory, 'manifest.json'), 'utf8'));
const audit = JSON.parse(await readFile(join(datasetDirectory, 'audit.json'), 'utf8'));
validateDataset(manifest, audit);
const datasetPath = join(datasetDirectory, manifest.artifact.fileName);
const datasetSha256 = await hashFile(datasetPath);
assertEqual(datasetSha256, expectedDatasetSha256, 'Dataset V6 SHA-256');
assertEqual(manifest.artifact.sha256, expectedDatasetSha256, 'Dataset V6 manifest SHA-256');

const refinementRaw = await readFile(refinementSummaryPath);
assertEqual(sha256(refinementRaw), expectedRefinementSummarySha256, 'refinement summary SHA-256');
const refinement = JSON.parse(refinementRaw.toString('utf8'));
validateRefinement(refinement);

const preferredResult = refinement.results?.find(
  (result) => result.variant === refinement.preferredVariant,
);
if (!preferredResult) {
  throw new Error('Preferred Behavioral V5.2 refinement result is missing.');
}
assertConfigurationEqual(
  request.selectedConfiguration,
  preferredResult.configuration,
  'selected full-training configuration',
);

const configuration = request.selectedConfiguration;
const rowCount = numberValue(manifest.artifact.rowCount);
const estimatedModelParameterCount =
  configuration.linearHashDimension +
  2 * configuration.embeddingHashDimension * configuration.latentDimension;
const estimatedModelWeightBytes = estimatedModelParameterCount * 8;
const trainingPasses = configuration.epochs * (configuration.foldCount + 1);
const evaluationPasses = 1;
const totalDatasetPasses = trainingPasses + evaluationPasses;
const estimatedDecisionVisits = rowCount > 0 ? rowCount * totalDatasetPasses : undefined;

const readinessChecks = {
  datasetEligible: true,
  exactDatasetSha: datasetSha256 === expectedDatasetSha256,
  refinementPreparedFullCandidate: refinement.fullTrainingCandidatePrepared === true,
  refinementNotFullAuthorized: refinement.fullTrainingAuthorized === false,
  refinementNotValueAuthorized: refinement.valueV8TrainingAuthorized === false,
  preferredConfigurationPinned: true,
  rawPropensityContract:
    preferredResult.configuration &&
    preferredResult.structuralAuditPassed === true,
  futureTestNotUsedForSelection: refinement.source?.futureTestRowCount === 0,
};
const readyForExplicitCostDecision = Object.values(readinessChecks).every(Boolean);

const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V5_2_FULL_READINESS',
  generatedAt: new Date().toISOString(),
  source: {
    datasetDirectory,
    datasetSha256,
    datasetRowCount: rowCount,
    refinementSummaryPath,
    refinementSummarySha256: expectedRefinementSummarySha256,
    preferredVariant: refinement.preferredVariant,
  },
  selectedConfiguration: configuration,
  costProjection: {
    trainingPasses,
    evaluationPasses,
    totalDatasetPasses,
    estimatedDecisionVisits,
    estimatedModelParameterCount,
    estimatedModelWeightBytes,
    note:
      'This is a deterministic work-unit projection, not a wall-clock estimate. Full training remains blocked until a separate explicit cost authorization.',
  },
  requiredFullReleaseGates: {
    candidateCoverageMinimum: 0.99,
    behaviorSupportCoverageMinimum: 0.9,
    majorLowSupportGroupCountMaximum: 0,
    extremeCandidateProbabilityRateMaximum: 0.01,
    probabilityFloorMaximumLogLossDeltaMaximum: 0.02,
    structuralAuditPassed: true,
    trainingArtifactEligible: true,
    fullCorpus: true,
    rawSoftmaxPropensity: true,
    futureTestUsedForTraining: false,
    futureTestUsedForSelection: false,
  },
  readinessChecks,
  readyForExplicitCostDecision,
  fullTrainingAuthorized: false,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};
await writeFile(reportPath, `${JSON.stringify(report, undefined, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

if (!readyForExplicitCostDecision) {
  throw new Error(
    `Behavioral V5.2 full readiness failed: ${Object.entries(readinessChecks)
      .filter(([, passed]) => passed !== true)
      .map(([name]) => name)
      .join(', ')}.`,
  );
}

function validateRequest(value) {
  if (
    value?.schemaVersion !== 1 ||
    value?.operation !== 'RECOMMENDATION_BEHAVIORAL_V5_2_FULL_READINESS' ||
    value?.fullTrainingReadinessAuthorized !== true ||
    value?.fullTrainingAuthorized !== false ||
    value?.valueV8TrainingAuthorized !== false ||
    value?.productionRankingChanged !== false ||
    value?.passiveShadowAuthorized !== false ||
    value?.randomizedCanaryAuthorized !== false ||
    !value?.selectedConfiguration
  ) {
    throw new Error('Invalid Behavioral V5.2 full-readiness request.');
  }
}

function validateDataset(manifest, audit) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2' ||
    manifest.auditPassed !== true ||
    manifest.trainingArtifactEligible !== true ||
    audit.passed !== true ||
    audit.trainingArtifactEligible !== true ||
    manifest.featureContract?.futureTestEligibleForSelection !== false ||
    manifest.featureContract?.userLiveUsedAsInput !== false
  ) {
    throw new Error('Dataset V6 is not eligible for Behavioral V5.2 full readiness.');
  }
}

function validateRefinement(value) {
  if (
    value?.schemaVersion !== 1 ||
    value?.operation !== 'RECOMMENDATION_BEHAVIORAL_V5_2_BOUNDED_REFINEMENT' ||
    value?.fullTrainingCandidatePrepared !== true ||
    value?.fullTrainingAuthorized !== false ||
    value?.valueV8TrainingAuthorized !== false ||
    value?.source?.datasetSha256 !== expectedDatasetSha256 ||
    value?.source?.futureTestRowCount !== 0
  ) {
    throw new Error('Behavioral V5.2 refinement is not eligible for full readiness.');
  }
}

function assertConfigurationEqual(actual, expected, label) {
  for (const key of [
    'linearHashDimension',
    'embeddingHashDimension',
    'latentDimension',
    'epochs',
    'learningRate',
    'foldCount',
    'l2',
    'supportProbability',
    'majorGroupMinDecisions',
  ]) {
    assertEqual(actual?.[key], expected?.[key], `${label}.${key}`);
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
function numberValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}
function requiredString(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}
function requiredSha256(name) {
  const value = requiredString(name);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a lowercase SHA-256 value.`);
  return value;
}
function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
}
