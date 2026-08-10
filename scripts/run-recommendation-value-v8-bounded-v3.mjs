import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const {
  RecommendationValueV8DiagnosticTrainingService,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-value-v8-diagnostic-training.service.js');

const BEHAVIORAL_SCHEMA_VERSION = 2;
const BEHAVIORAL_MODEL_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V5_1_HASHED_CONDITIONAL_CHOICE_2_RAW_PROPENSITY';
const BEHAVIORAL_FEATURE_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_4_CAPACITY_INTERACTIONS';
const VALUE_DIAGNOSTIC_VERSION = 'RECOMMENDATION_VALUE_V8_DIAGNOSTIC_1';

const datasetDirectory = requiredString('DEADLOCK_RECOMMENDATION_VALUE_V8_DATASET_DIR');
const behavioralDirectory = requiredString(
  'DEADLOCK_RECOMMENDATION_VALUE_V8_BEHAVIORAL_DIR',
);
const outputDirectory = requiredString(
  'DEADLOCK_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_DIR',
);
const evidencePath = requiredString('VALUE_V8_BOUNDED_EVIDENCE_PATH');
const expectedDatasetSha256 = requiredSha256('EXPECTED_DATASET_SHA256');
const expectedBehavioralPropensitySha256 = requiredSha256(
  'EXPECTED_BEHAVIORAL_PROPENSITY_SHA256',
);
const expectedBehavioralManifestSha256 = requiredSha256(
  'EXPECTED_BEHAVIORAL_MANIFEST_SHA256',
);

const options = {
  foldCount: 5,
  stateEpochs: 3,
  actionEpochs: 5,
  stateLearningRate: 0.03,
  actionLearningRate: 0.02,
  stateL2: 0.0001,
  actionL2: 0.0001,
  hashDimension: 4_096,
  propensityFloor: 0.01,
  maximumImportanceWeight: 20,
  maximumAbsolutePrediction: 1,
  maximumAbsoluteResidual: 1,
  maxRows: 50_000,
  expectedDatasetSha256,
  expectedBehavioralPropensitySha256,
  thresholds: {
    minimumTuningDecisionCount: 100,
    minimumStateRmseImprovement: 0,
    minimumCandidateSensitiveDecisionRate: 0.5,
    minimumAverageCandidateSeparation: 0.001,
    minimumCandidatePermutationRmseIncrease: 0,
    minimumMetadataPermutationRmseIncrease: 0,
    maximumAbsoluteCenteredMean: 1e-9,
  },
};

const behavioralManifestPath = join(behavioralDirectory, 'manifest.json');
const behavioralAuditPath = join(behavioralDirectory, 'audit.json');
const behavioralEvaluationPath = join(behavioralDirectory, 'evaluation.json');
const behavioralManifestRaw = await readFile(behavioralManifestPath);
assertEqual(
  sha256(behavioralManifestRaw),
  expectedBehavioralManifestSha256,
  'Behavioral manifest SHA-256',
);
const behavioralManifest = JSON.parse(behavioralManifestRaw.toString('utf8'));
const behavioralAudit = JSON.parse(await readFile(behavioralAuditPath, 'utf8'));
const behavioralEvaluation = JSON.parse(
  await readFile(behavioralEvaluationPath, 'utf8'),
);
validateBehavioralContract(
  behavioralManifest,
  behavioralAudit,
  behavioralEvaluation,
);

const propensityDescriptor = behavioralManifest.artifacts?.propensities;
const propensityFileName = propensityDescriptor?.fileName || 'propensities.ndjson';
const propensityPath = join(behavioralDirectory, propensityFileName);
const propensitySha256 = await hashFile(propensityPath);
assertEqual(
  propensitySha256,
  expectedBehavioralPropensitySha256,
  'Behavioral propensity SHA-256',
);
assertEqual(
  propensityDescriptor?.sha256,
  expectedBehavioralPropensitySha256,
  'Behavioral propensity manifest SHA-256',
);
const propensityContractAudit = await auditPropensityContract(propensityPath);

process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_DATASET_DIR = datasetDirectory;
process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_BEHAVIORAL_DIR = behavioralDirectory;
process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_DIR = outputDirectory;

const service = new RecommendationValueV8DiagnosticTrainingService();
await service.onModuleInit();
const initialStatus = service.getStatus();
assertEqual(initialStatus.state, 'IDLE', 'initial Value V8 status.state');

await service.start(options);
await service.waitForIdle();

const status = service.getStatus();
const model = service.getModel();
const evaluation = service.getEvaluation();
const audit = service.getAudit();
const manifest = service.getManifest();

const gateChecks = {
  statusComplete: status.state === 'COMPLETE' && status.phase === 'COMPLETE',
  statusDiagnosticGatePassed: status.diagnosticGatePassed === true,
  statusFullTrainingRecommended: status.fullTrainingRecommended === true,
  auditAvailable: Boolean(audit),
  auditPassed: audit?.passed === true,
  auditDiagnosticArtifactEligible: audit?.diagnosticArtifactEligible === true,
  auditFullTrainingRecommended: audit?.fullTrainingRecommended === true,
  auditDiagnosticOnly: audit?.build?.diagnosticOnly === true,
  auditMaxRows: audit?.build?.maxRows === 50_000,
  auditNotFullCorpus: audit?.build?.fullCorpus === false,
  auditFutureNotTraining: audit?.leakage?.futureTestUsedForTraining === false,
  auditFutureNotSelection: audit?.leakage?.futureTestUsedForSelection === false,
  auditTuningNotTraining: audit?.leakage?.tuningUsedForTraining === false,
  auditStateNoCandidateFeatures:
    audit?.leakage?.stateModelCandidateFeaturesUsed === false,
  auditActionObservedCandidateOnly:
    audit?.leakage?.actionModelObservedCandidateOnly === true,
  manifestAvailable: Boolean(manifest),
  manifestDiagnosticVersion:
    manifest?.diagnosticVersion === VALUE_DIAGNOSTIC_VERSION,
  manifestDiagnosticOnly: manifest?.diagnosticOnly === true,
  manifestFutureNotUsed: manifest?.futureTestUsed === false,
  manifestAuditPassed: manifest?.auditPassed === true,
  manifestDiagnosticGatePassed: manifest?.diagnosticGatePassed === true,
  manifestFullTrainingRecommended: manifest?.fullTrainingRecommended === true,
  evaluationAvailable: Boolean(evaluation),
  evaluationGatePassed: evaluation?.diagnosticGate?.passed === true,
  evaluationFullTrainingRecommended:
    evaluation?.diagnosticGate?.fullTrainingRecommended === true,
  evaluationFutureNotTraining: evaluation?.futureTest?.usedForTraining === false,
  evaluationFutureNotSelection: evaluation?.futureTest?.usedForSelection === false,
  evaluationFutureNotEvaluated: evaluation?.futureTest?.evaluated === false,
  modelAvailable: Boolean(model),
  modelDiagnosticOnly: model?.diagnosticOnly === true,
  modelRawBehavioralWeighting:
    model?.trainingContract?.behavioralWeighting ===
    'STABILIZED_INVERSE_PROPENSITY',
  modelFutureNotTraining:
    model?.trainingContract?.futureTestUsedForTraining === false,
  modelFutureNotSelection:
    model?.trainingContract?.futureTestUsedForSelection === false,
  sourceDatasetShaMatches:
    manifest?.source?.dataset?.sha256 === expectedDatasetSha256 &&
    audit?.source?.datasetSha256 === expectedDatasetSha256 &&
    model?.sourceDatasetSha256 === expectedDatasetSha256,
  behavioralPropensityShaMatches:
    manifest?.source?.behavioral?.sha256 ===
      expectedBehavioralPropensitySha256 &&
    audit?.source?.behavioralPropensitySha256 ===
      expectedBehavioralPropensitySha256 &&
    model?.behavioralPropensitySha256 === expectedBehavioralPropensitySha256,
  behavioralFeatureContractVerified:
    propensityContractAudit.invalidRowCount === 0 &&
    propensityContractAudit.featureVersionMismatchCount === 0,
};

const outputArtifactHashes = await hashOutputArtifacts(outputDirectory, manifest);
const evidence = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_VALUE_V8_BOUNDED_V3',
  generatedAt: new Date().toISOString(),
  datasetDirectory,
  behavioralDirectory,
  outputDirectory,
  expectedDatasetSha256,
  expectedBehavioralPropensitySha256,
  expectedBehavioralManifestSha256,
  behavioralContract: {
    schemaVersion: behavioralManifest.schemaVersion,
    modelVersion: behavioralManifest.modelVersion,
    featureVersion: behavioralManifest.featureVersion,
    releaseGatePassed: behavioralManifest.releaseGatePassed,
    auditPassed: behavioralManifest.auditPassed,
    trainingArtifactEligible: behavioralManifest.trainingArtifactEligible,
    probabilityContract:
      behavioralManifest.trainingContract?.propensityOutput,
    candidateProbabilityFloorApplied:
      behavioralManifest.trainingContract?.candidateProbabilityFloorApplied,
    ipsClippingApplied: behavioralManifest.trainingContract?.ipsClippingApplied,
    probabilityFloorSensitivity:
      behavioralManifest.trainingContract?.probabilityFloorSensitivity,
    propensityContractAudit,
  },
  options,
  status,
  gateChecks,
  audit,
  evaluation,
  manifest,
  outputArtifactHashes,
  valueV8DiagnosticAuthorized: true,
  fullValueV8TrainingAuthorized: false,
  offlineVerificationAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};

await writeFile(evidencePath, `${JSON.stringify(evidence, undefined, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));

const failedGates = Object.entries(gateChecks)
  .filter(([, passed]) => passed !== true)
  .map(([name]) => name);
if (failedGates.length > 0) {
  throw new Error(`Value V8 bounded gates failed: ${failedGates.join(', ')}.`);
}

function validateBehavioralContract(manifest, audit, evaluation) {
  assertEqual(manifest.schemaVersion, BEHAVIORAL_SCHEMA_VERSION, 'Behavioral schemaVersion');
  assertEqual(manifest.modelVersion, BEHAVIORAL_MODEL_VERSION, 'Behavioral modelVersion');
  assertEqual(
    manifest.featureVersion,
    BEHAVIORAL_FEATURE_VERSION,
    'Behavioral featureVersion',
  );
  assertEqual(manifest.auditPassed, true, 'Behavioral manifest audit');
  assertEqual(manifest.releaseGatePassed, true, 'Behavioral release gate');
  assertEqual(
    manifest.trainingArtifactEligible,
    true,
    'Behavioral training-artifact eligibility',
  );
  assertEqual(audit.passed, true, 'Behavioral audit.passed');
  assertEqual(
    audit.trainingArtifactEligible,
    true,
    'Behavioral audit training-artifact eligibility',
  );
  assertEqual(audit.build?.fullCorpus, true, 'Behavioral full-corpus build');
  assertEqual(evaluation.releaseGate?.passed, true, 'Behavioral evaluation gate');
  assertEqual(
    evaluation.futureTestPolicy?.usedForTraining,
    false,
    'Behavioral FUTURE_TEST training policy',
  );
  assertEqual(
    manifest.source?.sha256,
    expectedDatasetSha256,
    'Behavioral source Dataset SHA-256',
  );
  assertEqual(
    manifest.trainingContract?.propensityOutput,
    'RAW_SOFTMAX_WITHIN_DECISION',
    'Behavioral propensity output contract',
  );
  assertEqual(
    manifest.trainingContract?.candidateProbabilityFloorApplied,
    false,
    'Behavioral candidate probability floor',
  );
  assertEqual(
    manifest.trainingContract?.ipsClippingApplied,
    false,
    'Behavioral IPS clipping',
  );
  assertEqual(
    manifest.trainingContract?.probabilityFloorSensitivity,
    'OBSERVED_PROPENSITY_CLIP_ONLY',
    'Behavioral floor-sensitivity contract',
  );
}

async function auditPropensityContract(path) {
  const input = createReadStream(path).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  let rowCount = 0;
  let invalidRowCount = 0;
  let featureVersionMismatchCount = 0;
  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    rowCount += 1;
    try {
      const row = JSON.parse(line);
      if (
        row.schemaVersion !== BEHAVIORAL_SCHEMA_VERSION ||
        row.modelVersion !== BEHAVIORAL_MODEL_VERSION ||
        row.probabilityContract !== 'RAW_SOFTMAX_WITHIN_DECISION' ||
        row.propensityFloorApplied !== false ||
        row.observedActionProbability !== row.observedActionRawProbability
      ) {
        invalidRowCount += 1;
      }
      if (row.featureVersion !== BEHAVIORAL_FEATURE_VERSION) {
        featureVersionMismatchCount += 1;
      }
    } catch {
      invalidRowCount += 1;
    }
  }
  if (rowCount === 0) {
    throw new Error('Behavioral propensity artifact is empty.');
  }
  if (invalidRowCount > 0 || featureVersionMismatchCount > 0) {
    throw new Error(
      `Behavioral propensity contract audit failed: rows=${rowCount}, invalid=${invalidRowCount}, featureMismatch=${featureVersionMismatchCount}.`,
    );
  }
  return { rowCount, invalidRowCount, featureVersionMismatchCount };
}

async function hashOutputArtifacts(directory, manifest) {
  if (!manifest?.artifacts) {
    return {};
  }
  const result = {};
  for (const [name, descriptor] of Object.entries(manifest.artifacts)) {
    if (!descriptor?.fileName || !descriptor?.sha256) {
      continue;
    }
    const path = join(directory, descriptor.fileName);
    const actual = await hashFile(path);
    assertEqual(actual, descriptor.sha256, `${name} artifact SHA-256`);
    result[name] = {
      fileName: descriptor.fileName,
      sha256: actual,
      byteLength: (await stat(path)).size,
      rowCount: descriptor.rowCount,
    };
  }
  return result;
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function requiredString(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function requiredSha256(name) {
  const value = requiredString(name);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 value.`);
  }
  return value;
}
