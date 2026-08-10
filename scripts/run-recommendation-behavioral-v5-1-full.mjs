import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const {
  RecommendationBehavioralV5TrainingService,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v5-training.service.js');

const sourceDirectory = requiredString(
  'DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_SOURCE_DIR',
);
const outputDirectory = requiredString(
  'DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_DIR',
);
const sweepSummaryPath = requiredString('BEHAVIORAL_SWEEP_SUMMARY_PATH');
const evidencePath = requiredString('BEHAVIORAL_FULL_EVIDENCE_PATH');
const expectedDatasetSha256 = requiredSha256('EXPECTED_DATASET_SHA256');
const expectedSweepSummarySha256 = requiredSha256(
  'EXPECTED_SWEEP_SUMMARY_SHA256',
);
const expectedDiagnosticSampleSha256 = requiredSha256(
  'EXPECTED_DIAGNOSTIC_SAMPLE_SHA256',
);

const selectedVariant = {
  id: 'B',
  hashDimension: 65_536,
  epochs: 5,
  learningRate: 0.1,
  l2: 0.0001,
  foldCount: 5,
  propensityFloor: 0.01,
  supportProbability: 0.01,
  majorGroupMinDecisions: 100,
};

const sweepSummaryRaw = await readFile(sweepSummaryPath);
const sweepSummarySha256 = sha256(sweepSummaryRaw);
assertEqual(
  sweepSummarySha256,
  expectedSweepSummarySha256,
  'sweep summary SHA-256',
);
const sweepSummary = JSON.parse(sweepSummaryRaw.toString('utf8'));
validateSweepSummary(sweepSummary);

process.env.DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_SOURCE_DIR = sourceDirectory;
process.env.DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_DIR = outputDirectory;

const service = new RecommendationBehavioralV5TrainingService();
await service.onModuleInit();
const initialStatus = service.getStatus();
assertEqual(initialStatus.state, 'IDLE', 'initial status.state');

await service.start({
  foldCount: selectedVariant.foldCount,
  epochs: selectedVariant.epochs,
  learningRate: selectedVariant.learningRate,
  l2: selectedVariant.l2,
  hashDimension: selectedVariant.hashDimension,
  propensityFloor: selectedVariant.propensityFloor,
  supportProbability: selectedVariant.supportProbability,
  majorGroupMinDecisions: selectedVariant.majorGroupMinDecisions,
  expectedSourceSha256: expectedDatasetSha256,
});
await service.waitForIdle();

const status = service.getStatus();
const audit = service.getAudit();
const evaluation = service.getEvaluation();
const manifest = service.getManifest();
const model = service.getModel();

const gateChecks = {
  statusComplete: status.state === 'COMPLETE' && status.phase === 'COMPLETE',
  statusReleaseGatePassed: status.releaseGatePassed === true,
  statusTrainingArtifactEligible: status.trainingArtifactEligible === true,
  auditAvailable: Boolean(audit),
  auditPassed: audit?.passed === true,
  auditTrainingArtifactEligible: audit?.trainingArtifactEligible === true,
  auditFullCorpus: audit?.build?.fullCorpus === true,
  manifestAvailable: Boolean(manifest),
  manifestAuditPassed: manifest?.auditPassed === true,
  manifestReleaseGatePassed: manifest?.releaseGatePassed === true,
  manifestTrainingArtifactEligible: manifest?.trainingArtifactEligible === true,
  evaluationAvailable: Boolean(evaluation),
  evaluationReleaseGatePassed: evaluation?.releaseGate?.passed === true,
  futureTestReported: evaluation?.futureTestPolicy?.reported === true,
  futureTestNotUsedForTraining:
    evaluation?.futureTestPolicy?.usedForTraining === false,
  modelAvailable: Boolean(model),
  rawPropensityOutput:
    manifest?.trainingContract?.propensityOutput ===
    'RAW_SOFTMAX_WITHIN_DECISION',
  noCandidateProbabilityFloor:
    manifest?.trainingContract?.candidateProbabilityFloorApplied === false,
  noIpsClippingInBehavioral:
    manifest?.trainingContract?.ipsClippingApplied === false,
  observedOnlyFloorSensitivity:
    manifest?.trainingContract?.probabilityFloorSensitivity ===
    'OBSERVED_PROPENSITY_CLIP_ONLY',
  rawAuditProbabilityContract:
    audit?.predictions?.probabilityContract === 'RAW_SOFTMAX_WITHIN_DECISION',
  auditPropensityFloorNotApplied:
    audit?.predictions?.propensityFloorApplied === false,
  sourceDatasetShaMatches:
    manifest?.source?.sha256 === expectedDatasetSha256 &&
    audit?.source?.actualSha256 === expectedDatasetSha256,
};

const evidence = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V5_1_FULL_TRAINING',
  generatedAt: new Date().toISOString(),
  sourceDirectory,
  outputDirectory,
  expectedDatasetSha256,
  selectedVariant,
  sweepEvidence: {
    summaryPath: sweepSummaryPath,
    summarySha256: sweepSummarySha256,
    diagnosticSampleSha256: expectedDiagnosticSampleSha256,
    preferredDiagnosticVariant: sweepSummary.preferredDiagnosticVariant,
  },
  status,
  gateChecks,
  audit: audit
    ? {
        passed: audit.passed,
        trainingArtifactEligible: audit.trainingArtifactEligible,
        source: audit.source,
        crossFitting: audit.crossFitting,
        predictions: audit.predictions,
        releaseGate: audit.releaseGate,
        build: audit.build,
        reasons: audit.reasons,
      }
    : undefined,
  evaluation: evaluation
    ? {
        schemaVersion: evaluation.schemaVersion,
        modelVersion: evaluation.modelVersion,
        propensityContract: evaluation.propensityContract,
        metrics: evaluation.metrics,
        candidateCoverage: evaluation.candidateCoverage,
        releaseGate: evaluation.releaseGate,
        futureTestPolicy: evaluation.futureTestPolicy,
      }
    : undefined,
  manifest: manifest
    ? {
        schemaVersion: manifest.schemaVersion,
        modelVersion: manifest.modelVersion,
        featureVersion: manifest.featureVersion,
        source: manifest.source,
        trainingContract: manifest.trainingContract,
        options: manifest.options,
        artifacts: manifest.artifacts,
        releaseGatePassed: manifest.releaseGatePassed,
        auditPassed: manifest.auditPassed,
        trainingArtifactEligible: manifest.trainingArtifactEligible,
      }
    : undefined,
  modelContract: model
    ? {
        schemaVersion: model.schemaVersion,
        modelVersion: model.modelVersion,
        featureVersion: model.featureVersion,
        hashDimension: model.hashDimension,
        trainedDecisionCount: model.trainedDecisionCount,
      }
    : undefined,
  fullTrainingAuthorized: true,
  valueV8TrainingAuthorized: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};

await writeFile(evidencePath, `${JSON.stringify(evidence, undefined, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));

const failedGates = Object.entries(gateChecks)
  .filter(([, passed]) => passed !== true)
  .map(([name]) => name);
if (failedGates.length > 0) {
  throw new Error(`Behavioral V5.1 full training gates failed: ${failedGates.join(', ')}.`);
}

function validateSweepSummary(summary) {
  assertEqual(
    summary.operation,
    'RECOMMENDATION_BEHAVIORAL_V5_1_BOUNDED_SWEEP',
    'sweep operation',
  );
  assertEqual(summary.expectedSourceSha256, expectedDatasetSha256, 'sweep source SHA');
  assertEqual(summary.preferredDiagnosticVariant, selectedVariant.id, 'selected variant');
  assertEqual(summary.fullTrainingAuthorized, false, 'sweep full-training authorization');
  assertEqual(summary.valueV8TrainingAuthorized, false, 'sweep Value V8 authorization');
  assertEqual(summary.diagnosticSample?.unit, 'MATCH', 'sample unit');
  assertEqual(summary.diagnosticSample?.hash, 'FNV1A_32', 'sample hash');
  assertEqual(summary.diagnosticSample?.modulo, 16, 'sample modulo');
  assertEqual(summary.diagnosticSample?.remainder, 0, 'sample remainder');
  assertEqual(
    summary.diagnosticSample?.sha256,
    expectedDiagnosticSampleSha256,
    'diagnostic sample SHA-256',
  );
  assertEqual(
    summary.diagnosticSample?.futureTestEvaluated,
    false,
    'diagnostic FUTURE_TEST policy',
  );

  const result = summary.results?.find((value) => value.variant === selectedVariant.id);
  if (!result) {
    throw new Error('Selected sweep variant B is missing.');
  }
  assertEqual(result.auditPassed, true, 'selected sweep audit');
  assertEqual(result.trainingArtifactEligible, false, 'sampled artifact eligibility');
  assertEqual(result.configuration?.hashDimension, selectedVariant.hashDimension, 'hash dimension');
  assertEqual(result.configuration?.epochs, selectedVariant.epochs, 'epochs');
  assertEqual(result.configuration?.learningRate, selectedVariant.learningRate, 'learning rate');
  assertEqual(result.configuration?.l2, selectedVariant.l2, 'L2');
  assertEqual(result.configuration?.foldCount, selectedVariant.foldCount, 'fold count');
  assertEqual(
    result.configuration?.supportProbability,
    selectedVariant.supportProbability,
    'support probability',
  );
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
