import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const {
  RecommendationBehavioralV5TrainingService,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v5-training.service.js');

const sourceDirectory = requiredString(
  'DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_SOURCE_DIR',
);
const expectedSourceSha256 = requiredSha256('EXPECTED_DATASET_SHA256');
const summaryDirectory = requiredString('BEHAVIORAL_SWEEP_SUMMARY_DIR');
const diagnosticMatchModulo = requiredInteger('BEHAVIORAL_SWEEP_MATCH_MODULO');
const diagnosticMatchRemainder = requiredNonNegativeInteger(
  'BEHAVIORAL_SWEEP_MATCH_REMAINDER',
);

const variants = [
  {
    id: 'A',
    outputDirectory: requiredString('BEHAVIORAL_SWEEP_A_DIR'),
    hashDimension: 32_768,
    epochs: 3,
    learningRate: 0.1,
  },
  {
    id: 'B',
    outputDirectory: requiredString('BEHAVIORAL_SWEEP_B_DIR'),
    hashDimension: 65_536,
    epochs: 5,
    learningRate: 0.1,
  },
  {
    id: 'C',
    outputDirectory: requiredString('BEHAVIORAL_SWEEP_C_DIR'),
    hashDimension: 131_072,
    epochs: 5,
    learningRate: 0.05,
  },
];

const commonOptions = {
  foldCount: 5,
  l2: 0.0001,
  propensityFloor: 0.01,
  supportProbability: 0.01,
  majorGroupMinDecisions: 100,
  expectedSourceSha256,
  diagnosticMatchModulo,
  diagnosticMatchRemainder,
};

await mkdir(summaryDirectory, { recursive: true });
const results = [];
let expectedSampleSha256;

for (const variant of variants) {
  process.env.DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_SOURCE_DIR = sourceDirectory;
  process.env.DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_DIR =
    variant.outputDirectory;

  const service = new RecommendationBehavioralV5TrainingService();
  await service.onModuleInit();
  const initialStatus = service.getStatus();
  if (initialStatus.state !== 'IDLE') {
    throw new Error(
      `Variant ${variant.id} output is not empty: ${initialStatus.state}/${initialStatus.phase}.`,
    );
  }

  await service.start({
    ...commonOptions,
    hashDimension: variant.hashDimension,
    epochs: variant.epochs,
    learningRate: variant.learningRate,
  });
  await service.waitForIdle();

  const status = service.getStatus();
  const audit = service.getAudit();
  const evaluation = service.getEvaluation();
  const manifest = service.getManifest();
  const model = service.getModel();
  if (!audit || !evaluation || !manifest || !model) {
    throw new Error(`Variant ${variant.id} did not produce all Behavioral artifacts.`);
  }
  assertEqual(status.state, 'COMPLETE', `${variant.id} status.state`);
  assertEqual(status.phase, 'COMPLETE', `${variant.id} status.phase`);
  assertEqual(audit.passed, true, `${variant.id} audit.passed`);
  assertEqual(
    audit.trainingArtifactEligible,
    false,
    `${variant.id} sampled artifact eligibility`,
  );
  assertEqual(
    manifest.trainingArtifactEligible,
    false,
    `${variant.id} manifest sampled artifact eligibility`,
  );
  assertEqual(
    audit.build?.fullCorpus,
    false,
    `${variant.id} audit.build.fullCorpus`,
  );
  assertEqual(
    audit.source?.futureTestEligibleDecisionCount,
    0,
    `${variant.id} FUTURE_TEST eligible count`,
  );
  assertEqual(
    evaluation.futureTestPolicy?.reported,
    false,
    `${variant.id} FUTURE_TEST reporting`,
  );
  assertEqual(
    model.trainingDataPolicy?.futureTestEvaluated,
    false,
    `${variant.id} FUTURE_TEST evaluation`,
  );
  assertEqual(
    model.trainingDataPolicy?.futureTestUsedForTraining,
    false,
    `${variant.id} FUTURE_TEST training`,
  );
  assertEqual(
    audit.build?.diagnosticMatchSample?.modulo,
    diagnosticMatchModulo,
    `${variant.id} sample modulo`,
  );
  assertEqual(
    audit.build?.diagnosticMatchSample?.remainder,
    diagnosticMatchRemainder,
    `${variant.id} sample remainder`,
  );
  assertEqual(
    audit.build?.diagnosticMatchSample?.futureTestEvaluated,
    false,
    `${variant.id} sample future-test policy`,
  );

  const sampleArtifact = audit.build?.diagnosticMatchSample?.artifact;
  const sampleSha256 = requiredObjectSha256(
    sampleArtifact,
    `${variant.id} diagnostic sample SHA-256`,
  );
  if (expectedSampleSha256 === undefined) {
    expectedSampleSha256 = sampleSha256;
  } else if (sampleSha256 !== expectedSampleSha256) {
    throw new Error(
      `Diagnostic sample SHA mismatch: expected ${expectedSampleSha256}, received ${sampleSha256} for ${variant.id}.`,
    );
  }

  const metrics = evaluation.metrics ?? {};
  const releaseGate = evaluation.releaseGate ?? {};
  const result = {
    variant: variant.id,
    configuration: {
      hashDimension: variant.hashDimension,
      epochs: variant.epochs,
      learningRate: variant.learningRate,
      l2: commonOptions.l2,
      foldCount: commonOptions.foldCount,
      supportProbability: commonOptions.supportProbability,
    },
    outputDirectory: variant.outputDirectory,
    sourceDatasetSha256: manifest.source?.sha256,
    diagnosticSampleSha256: sampleSha256,
    diagnosticSampleRowCount: sampleArtifact?.rowCount,
    releaseGatePassed: releaseGate.passed === true,
    candidateCoverage: releaseGate.candidateCoverage,
    behaviorSupportCoverage: releaseGate.behaviorSupportCoverage,
    majorLowSupportGroupCount: Array.isArray(releaseGate.majorLowSupportGroups)
      ? releaseGate.majorLowSupportGroups.length
      : undefined,
    extremeCandidateProbabilityRate:
      releaseGate.extremeCandidateProbabilityRate,
    probabilityFloorMaximumLogLossDelta:
      releaseGate.probabilityFloorMaximumLogLossDelta,
    selectionMetrics: metrics.selection,
    trainMetrics: metrics.bySplit?.TRAIN,
    tuningMetrics: metrics.bySplit?.TUNING,
    probabilityFloorSensitivity: metrics.probabilityFloorSensitivity,
    releaseReasons: releaseGate.reasons,
    auditPassed: audit.passed === true,
    trainingArtifactEligible: audit.trainingArtifactEligible === true,
  };
  results.push(result);
  console.log(JSON.stringify(result, null, 2));
}

const ranked = [...results].sort(compareVariants);
const summary = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V5_1_BOUNDED_SWEEP',
  generatedAt: new Date().toISOString(),
  sourceDirectory,
  expectedSourceSha256,
  diagnosticSample: {
    unit: 'MATCH',
    hash: 'FNV1A_32',
    modulo: diagnosticMatchModulo,
    remainder: diagnosticMatchRemainder,
    sha256: expectedSampleSha256,
    futureTestEvaluated: false,
  },
  selectionProtocol: [
    'releaseGatePassed DESC',
    'majorLowSupportGroupCount ASC',
    'behaviorSupportCoverage DESC',
    'selection.rawLogLoss ASC',
    'selection.top1Rate DESC',
    'probabilityFloorMaximumLogLossDelta ASC',
    'variant ASC',
  ],
  preferredDiagnosticVariant: ranked[0]?.variant,
  fullTrainingAuthorized: false,
  valueV8TrainingAuthorized: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
  results,
};

const summaryPath = join(summaryDirectory, 'sweep-summary.json');
await writeFile(summaryPath, `${JSON.stringify(summary, undefined, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));

function compareVariants(left, right) {
  return (
    compareBooleanDesc(left.releaseGatePassed, right.releaseGatePassed) ||
    compareNumberAsc(
      left.majorLowSupportGroupCount,
      right.majorLowSupportGroupCount,
    ) ||
    compareNumberDesc(
      left.behaviorSupportCoverage,
      right.behaviorSupportCoverage,
    ) ||
    compareNumberAsc(
      left.selectionMetrics?.rawLogLoss,
      right.selectionMetrics?.rawLogLoss,
    ) ||
    compareNumberDesc(
      left.selectionMetrics?.top1Rate,
      right.selectionMetrics?.top1Rate,
    ) ||
    compareNumberAsc(
      left.probabilityFloorMaximumLogLossDelta,
      right.probabilityFloorMaximumLogLossDelta,
    ) ||
    left.variant.localeCompare(right.variant)
  );
}

function compareBooleanDesc(left, right) {
  return Number(Boolean(right)) - Number(Boolean(left));
}

function compareNumberAsc(left, right) {
  const leftValue = Number.isFinite(left) ? left : Number.POSITIVE_INFINITY;
  const rightValue = Number.isFinite(right) ? right : Number.POSITIVE_INFINITY;
  return leftValue - rightValue;
}

function compareNumberDesc(left, right) {
  const leftValue = Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY;
  const rightValue = Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY;
  return rightValue - leftValue;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function requiredObjectSha256(value, label) {
  const sha256 = value?.sha256;
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return sha256;
}

function requiredString(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function requiredInteger(name) {
  const value = Number(requiredString(name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

function requiredNonNegativeInteger(name) {
  const value = Number(requiredString(name));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
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
