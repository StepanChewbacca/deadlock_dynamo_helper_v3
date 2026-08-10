import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const require = createRequire(import.meta.url);
const {
  createRecommendationBehavioralV52Model,
  predictRecommendationBehavioralV52,
  recommendationBehavioralV52FoldId,
  RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
  RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
  stabilizeRecommendationBehavioralV52ObservedProbability,
  trainRecommendationBehavioralV52Decision,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v5-2.js');
const {
  openMaybeGzipNdjsonReadStream,
} = require('/app/apps/api/dist/src/deadlock-live/gzip-ndjson.js');

const sourceDirectory = requiredString(
  'DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_2_SOURCE_DIR',
);
const samplePath = requiredString('BEHAVIORAL_V5_2_SAMPLE_PATH');
const v51SweepSummaryPath = requiredString('BEHAVIORAL_V5_1_SWEEP_SUMMARY_PATH');
const outputDirectory = requiredString('BEHAVIORAL_V5_2_OUTPUT_DIR');
const expectedDatasetSha256 = requiredSha256('EXPECTED_DATASET_SHA256');
const expectedSampleSha256 = requiredSha256('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');
const expectedV51SweepSummarySha256 = requiredSha256(
  'EXPECTED_V5_1_SWEEP_SUMMARY_SHA256',
);

const datasetManifestPath = join(sourceDirectory, 'manifest.json');
const datasetAuditPath = join(sourceDirectory, 'audit.json');
const datasetManifest = await requiredJson(datasetManifestPath);
const datasetAudit = await requiredJson(datasetAuditPath);
validateDatasetSource(datasetManifest, datasetAudit);

const datasetArtifactPath = join(
  sourceDirectory,
  datasetManifest.artifact.fileName,
);
assertEqual(
  await hashFile(datasetArtifactPath),
  expectedDatasetSha256,
  'Dataset V6 artifact SHA-256',
);
assertEqual(
  datasetManifest.artifact.sha256,
  expectedDatasetSha256,
  'Dataset V6 manifest SHA-256',
);
assertEqual(
  await hashFile(samplePath),
  expectedSampleSha256,
  'diagnostic sample SHA-256',
);

const v51SweepSummaryRaw = await readFile(v51SweepSummaryPath);
assertEqual(
  sha256(v51SweepSummaryRaw),
  expectedV51SweepSummarySha256,
  'V5.1 sweep summary SHA-256',
);
const v51SweepSummary = JSON.parse(v51SweepSummaryRaw.toString('utf8'));
validateV51SweepSummary(v51SweepSummary);
const v51Baseline = requiredPreferredV51Result(v51SweepSummary);

const sampleRows = await loadDiagnosticSample(samplePath);
const trainRows = sampleRows.filter((row) => row.split === 'TRAIN');
const tuningRows = sampleRows.filter((row) => row.split === 'TUNING');
if (trainRows.length === 0 || tuningRows.length === 0) {
  throw new Error('Behavioral V5.2 bounded sample requires TRAIN and TUNING rows.');
}

const variants = [
  {
    id: 'A',
    linearHashDimension: 8_192,
    embeddingHashDimension: 2_048,
    latentDimension: 4,
    epochs: 3,
    learningRate: 0.1,
  },
  {
    id: 'B',
    linearHashDimension: 8_192,
    embeddingHashDimension: 4_096,
    latentDimension: 8,
    epochs: 4,
    learningRate: 0.08,
  },
  {
    id: 'C',
    linearHashDimension: 16_384,
    embeddingHashDimension: 8_192,
    latentDimension: 12,
    epochs: 4,
    learningRate: 0.05,
  },
];

const commonOptions = {
  foldCount: 5,
  l2: 0.0001,
  supportProbability: 0.01,
  propensityFloors: [0.005, 0.01, 0.02],
  majorGroupMinDecisions: 100,
};

validateFoldCoverage(trainRows, commonOptions.foldCount);
await mkdir(outputDirectory, { recursive: true });
const results = [];

for (const variant of variants) {
  const variantDirectory = join(outputDirectory, variant.id.toLowerCase());
  await mkdir(variantDirectory, { recursive: true });
  const result = await runVariant(
    variant,
    variantDirectory,
    trainRows,
    tuningRows,
    commonOptions,
  );
  results.push(result);
  console.log(JSON.stringify(result, null, 2));
}

const ranked = [...results].sort(compareVariants);
const preferred = ranked[0];
const continuation = architectureContinuation(preferred, v51Baseline);
const summary = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V5_2_BOUNDED_ARCHITECTURE_SWEEP',
  generatedAt: new Date().toISOString(),
  architecture: 'LOW_RANK_TWO_TOWER_CONDITIONAL_CHOICE',
  source: {
    directory: sourceDirectory,
    datasetSha256: expectedDatasetSha256,
    samplePath,
    sampleSha256: expectedSampleSha256,
    sampleContract: {
      inheritedFrom: 'RECOMMENDATION_BEHAVIORAL_V5_1_BOUNDED_SWEEP',
      unit: 'MATCH',
      hash: 'FNV1A_32',
      modulo: 16,
      remainder: 0,
      futureTestEvaluated: false,
    },
    sampleRowCount: sampleRows.length,
    trainRowCount: trainRows.length,
    tuningRowCount: tuningRows.length,
    futureTestRowCount: 0,
  },
  v51Baseline: {
    sweepSummarySha256: expectedV51SweepSummarySha256,
    preferredVariant: v51SweepSummary.preferredDiagnosticVariant,
    metrics: comparableMetrics(v51Baseline),
  },
  selectionProtocol: [
    'releaseGatePassed DESC',
    'majorLowSupportGroupCount ASC',
    'supportCoverage DESC',
    'rawLogLoss ASC',
    'top1Rate DESC',
    'floorSensitivityDelta ASC',
    'modelByteLength ASC',
    'variant ASC',
  ],
  preferredVariant: preferred.variant,
  continuationCriteria: {
    minimumSupportCoverageImprovement: 0.05,
    maximumRawLogLossRegression: 0.02,
    requireMajorLowSupportGroupReduction: true,
    requireStructuralAuditPassed: true,
    requireRawPropensityContract: true,
  },
  architectureContinuationRecommended: continuation.passed,
  continuationChecks: continuation.checks,
  continuationReasons: continuation.reasons,
  boundedRefinementAuthorized: false,
  fullTrainingAuthorized: false,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
  results,
};

const summaryPath = join(outputDirectory, 'sweep-summary.json');
await atomicJson(summaryPath, summary);
const reportPath = join(outputDirectory, 'sweep-report.txt');
await writeFile(
  reportPath,
  renderReport(summary),
  'utf8',
);
console.log(JSON.stringify(summary, null, 2));

async function runVariant(
  variant,
  variantDirectory,
  trainRows,
  tuningRows,
  options,
) {
  const config = {
    linearHashDimension: variant.linearHashDimension,
    embeddingHashDimension: variant.embeddingHashDimension,
    latentDimension: variant.latentDimension,
  };
  const foldRows = Array.from({ length: options.foldCount }, () => []);
  for (const row of trainRows) {
    foldRows[recommendationBehavioralV52FoldId(row.matchId, options.foldCount)].push(
      row,
    );
  }

  const foldModels = [];
  for (let holdoutFoldId = 0; holdoutFoldId < options.foldCount; holdoutFoldId += 1) {
    const model = createRecommendationBehavioralV52Model(config);
    for (let epoch = 0; epoch < variant.epochs; epoch += 1) {
      for (let foldId = 0; foldId < foldRows.length; foldId += 1) {
        if (foldId === holdoutFoldId) {
          continue;
        }
        for (const row of foldRows[foldId]) {
          trainRecommendationBehavioralV52Decision(model, row, {
            learningRate: variant.learningRate,
            l2: options.l2,
          });
        }
      }
      await tick();
    }
    const expectedTrainingDecisionCount =
      (trainRows.length - foldRows[holdoutFoldId].length) * variant.epochs;
    assertEqual(
      model.trainedDecisionCount,
      expectedTrainingDecisionCount,
      `${variant.id} fold ${holdoutFoldId} training count`,
    );
    foldModels.push(model);
  }

  const finalModel = createRecommendationBehavioralV52Model(config);
  for (let epoch = 0; epoch < variant.epochs; epoch += 1) {
    for (const row of trainRows) {
      trainRecommendationBehavioralV52Decision(finalModel, row, {
        learningRate: variant.learningRate,
        l2: options.l2,
      });
    }
    await tick();
  }
  assertEqual(
    finalModel.trainedDecisionCount,
    trainRows.length * variant.epochs,
    `${variant.id} final training count`,
  );

  const accumulator = createAccumulator(options.propensityFloors);
  let oofPredictionCount = 0;
  for (const row of trainRows) {
    const foldId = recommendationBehavioralV52FoldId(
      row.matchId,
      options.foldCount,
    );
    const prediction = predictRecommendationBehavioralV52(
      foldModels[foldId],
      row,
    );
    observePrediction(
      accumulator,
      row,
      prediction,
      options.supportProbability,
      options.majorGroupMinDecisions,
    );
    oofPredictionCount += 1;
  }
  let tuningPredictionCount = 0;
  for (const row of tuningRows) {
    const prediction = predictRecommendationBehavioralV52(finalModel, row);
    observePrediction(
      accumulator,
      row,
      prediction,
      options.supportProbability,
      options.majorGroupMinDecisions,
    );
    tuningPredictionCount += 1;
  }

  const metrics = finalizeAccumulator(
    accumulator,
    options.majorGroupMinDecisions,
  );
  const releaseGate = buildReleaseGate(metrics, options.majorGroupMinDecisions);
  const structuralReasons = [];
  if (oofPredictionCount !== trainRows.length) {
    structuralReasons.push('OOF TRAIN predictions are incomplete.');
  }
  if (tuningPredictionCount !== tuningRows.length) {
    structuralReasons.push('TUNING predictions are incomplete.');
  }
  if (foldRows.some((rows) => rows.length === 0)) {
    structuralReasons.push('At least one MATCH fold has no TRAIN decisions.');
  }
  const structuralAuditPassed = structuralReasons.length === 0;

  const modelArtifact = {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
    generatedAt: new Date().toISOString(),
    diagnosticOnly: true,
    sourceDatasetSha256: expectedDatasetSha256,
    diagnosticSampleSha256: expectedSampleSha256,
    configuration: {
      ...variant,
      foldCount: options.foldCount,
      l2: options.l2,
      supportProbability: options.supportProbability,
    },
    trainingContract: {
      architecture: 'LINEAR_RESIDUAL_PLUS_LOW_RANK_TWO_TOWER',
      target: 'OBSERVED_ACTION_WITHIN_CANDIDATE_SET',
      normalization: 'SOFTMAX_WITHIN_DECISION',
      propensityOutput: RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
      candidateProbabilityFloorApplied: false,
      ipsClippingApplied: false,
      probabilityFloorSensitivity: 'OBSERVED_PROPENSITY_CLIP_ONLY',
      crossFittingUnit: 'MATCH',
      trainSplitOnly: true,
      tuningUsedForTraining: false,
      futureTestUsedForTraining: false,
      futureTestUsedForCalibration: false,
      futureTestUsedForSelection: false,
      outcomeFieldsUsed: false,
    },
    finalModel,
  };
  const modelPath = join(variantDirectory, 'model.json');
  await atomicJson(modelPath, modelArtifact);
  const modelByteLength = (await stat(modelPath)).size;
  const modelSha256 = await hashFile(modelPath);

  const evaluation = {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    metrics,
    releaseGate,
    futureTestPolicy: {
      reported: false,
      usedForTraining: false,
      usedForCalibration: false,
      usedForSelection: false,
      evaluated: false,
    },
  };
  const evaluationPath = join(variantDirectory, 'evaluation.json');
  await atomicJson(evaluationPath, evaluation);

  const audit = {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    passed: structuralAuditPassed,
    trainingArtifactEligible: false,
    diagnosticOnly: true,
    source: {
      datasetSha256: expectedDatasetSha256,
      diagnosticSampleSha256: expectedSampleSha256,
      trainDecisionCount: trainRows.length,
      tuningDecisionCount: tuningRows.length,
      futureTestDecisionCount: 0,
    },
    crossFitting: {
      unit: 'MATCH',
      foldCount: options.foldCount,
      foldDecisionCounts: foldRows.map((rows) => rows.length),
      oofPredictionCount,
      trainingMatchExclusionVerified: true,
    },
    probabilityContract: {
      output: RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
      candidateProbabilityFloorApplied: false,
      observedOnlyFloorSensitivity: true,
    },
    releaseGate,
    reasons: structuralReasons,
  };
  const auditPath = join(variantDirectory, 'audit.json');
  await atomicJson(auditPath, audit);

  const manifest = {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceDatasetSha256: expectedDatasetSha256,
    diagnosticSampleSha256: expectedSampleSha256,
    diagnosticOnly: true,
    auditPassed: structuralAuditPassed,
    releaseGatePassed: releaseGate.passed,
    trainingArtifactEligible: false,
    artifacts: {
      model: {
        fileName: 'model.json',
        sha256: modelSha256,
        byteLength: modelByteLength,
      },
      evaluation: {
        fileName: 'evaluation.json',
        sha256: await hashFile(evaluationPath),
      },
      audit: {
        fileName: 'audit.json',
        sha256: await hashFile(auditPath),
      },
    },
  };
  await atomicJson(join(variantDirectory, 'manifest.json'), manifest);

  return {
    variant: variant.id,
    configuration: modelArtifact.configuration,
    sourceDatasetSha256: expectedDatasetSha256,
    diagnosticSampleSha256: expectedSampleSha256,
    supportCoverage: metrics.selection.supportCoverage,
    rawLogLoss: metrics.selection.rawLogLoss,
    top1Rate: metrics.selection.top1Rate,
    meanObservedRawProbability: metrics.selection.meanObservedRawProbability,
    minimumObservedRawProbability: metrics.selection.minimumObservedRawProbability,
    floorSensitivityDelta: metrics.probabilityFloorSensitivity.maximumLogLossDelta,
    extremeCandidateProbabilityRate:
      metrics.selection.extremeCandidateProbabilityRate,
    majorLowSupportGroupCount: releaseGate.majorLowSupportGroups.length,
    candidateCoverage: metrics.selection.candidateCoverage,
    releaseGatePassed: releaseGate.passed,
    structuralAuditPassed,
    trainingArtifactEligible: false,
    modelByteLength,
    modelSha256,
    trainMetrics: metrics.bySplit.TRAIN,
    tuningMetrics: metrics.bySplit.TUNING,
    releaseReasons: releaseGate.reasons,
    structuralReasons,
  };
}

function createAccumulator(probabilityFloors) {
  return {
    bySplit: {
      TRAIN: emptyMetrics(),
      TUNING: emptyMetrics(),
    },
    selection: emptyMetrics(),
    groups: new Map(),
    floorLogLossSums: new Map(probabilityFloors.map((floor) => [floor, 0])),
    probabilityFloors,
  };
}

function emptyMetrics() {
  return {
    decisionCount: 0,
    candidateCount: 0,
    coveredDecisionCount: 0,
    supportedDecisionCount: 0,
    top1Count: 0,
    rawLogLossSum: 0,
    rawBrierSum: 0,
    entropySum: 0,
    observedProbabilitySum: 0,
    minimumObservedRawProbability: Number.POSITIVE_INFINITY,
    maximumCandidateProbability: 0,
    extremeCandidateProbabilityCount: 0,
  };
}

function observePrediction(
  accumulator,
  row,
  prediction,
  supportProbability,
) {
  assertRawPrediction(prediction);
  const supported = prediction.observedActionProbability >= supportProbability;
  observeMetrics(accumulator.bySplit[row.split], row, prediction, supported);
  observeMetrics(accumulator.selection, row, prediction, supported);

  const observedCandidate = row.candidates.find(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  const groupDescriptors = [
    ['HERO', String(row.state.heroId)],
    ['TIME_BUCKET', String(Math.floor(row.state.gameTimeS / 300))],
    ['ITEM_TIER', String(observedCandidate?.tier ?? 'UNKNOWN')],
    ['ECONOMY_BAND', economyBand(row.state.netWorth)],
  ];
  const rawLogLoss = -Math.log(
    Math.max(prediction.observedActionProbability, 1e-15),
  );
  for (const [type, value] of groupDescriptors) {
    const key = `${type}:${value}`;
    const group = accumulator.groups.get(key) ?? {
      type,
      value,
      decisionCount: 0,
      supportedDecisionCount: 0,
      rawLogLossSum: 0,
    };
    group.decisionCount += 1;
    group.supportedDecisionCount += supported ? 1 : 0;
    group.rawLogLossSum += rawLogLoss;
    accumulator.groups.set(key, group);
  }

  for (const floor of accumulator.probabilityFloors) {
    const clipped = stabilizeRecommendationBehavioralV52ObservedProbability(
      prediction.observedActionProbability,
      floor,
    );
    accumulator.floorLogLossSums.set(
      floor,
      accumulator.floorLogLossSums.get(floor) -
        Math.log(Math.max(clipped, 1e-15)),
    );
  }
}

function observeMetrics(state, row, prediction, supported) {
  const probabilities = new Map(
    prediction.candidates.map((candidate) => [
      candidate.actionKey,
      candidate.probability,
    ]),
  );
  state.decisionCount += 1;
  state.candidateCount += row.candidates.length;
  state.coveredDecisionCount += probabilities.has(row.observedActionKey) ? 1 : 0;
  state.supportedDecisionCount += supported ? 1 : 0;
  state.top1Count += prediction.topActionKey === row.observedActionKey ? 1 : 0;
  state.rawLogLossSum += -Math.log(
    Math.max(prediction.observedActionProbability, 1e-15),
  );
  state.entropySum += prediction.entropy;
  state.observedProbabilitySum += prediction.observedActionProbability;
  state.minimumObservedRawProbability = Math.min(
    state.minimumObservedRawProbability,
    prediction.observedActionProbability,
  );
  state.maximumCandidateProbability = Math.max(
    state.maximumCandidateProbability,
    prediction.maximumProbability,
  );
  for (const candidate of row.candidates) {
    const probability = probabilities.get(candidate.actionKey) ?? 0;
    const label = candidate.actionKey === row.observedActionKey ? 1 : 0;
    state.rawBrierSum += (probability - label) ** 2;
    state.extremeCandidateProbabilityCount +=
      probability <= 1e-6 || probability >= 1 - 1e-6 ? 1 : 0;
  }
}

function finalizeAccumulator(accumulator, majorGroupMinDecisions) {
  const bySplit = {
    TRAIN: finalizeMetrics(accumulator.bySplit.TRAIN),
    TUNING: finalizeMetrics(accumulator.bySplit.TUNING),
  };
  const selection = finalizeMetrics(accumulator.selection);
  const floors = [...accumulator.floorLogLossSums.entries()]
    .sort(([left], [right]) => left - right)
    .map(([floor, logLossSum]) => ({
      floor,
      decisionCount: selection.decisionCount,
      logLoss: divide(logLossSum, selection.decisionCount),
    }));
  const finiteLosses = floors
    .map((value) => value.logLoss)
    .filter((value) => Number.isFinite(value));
  const maximumLogLossDelta =
    finiteLosses.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(...finiteLosses) - Math.min(...finiteLosses);
  const groups = [...accumulator.groups.values()]
    .map((group) => ({
      type: group.type,
      value: group.value,
      decisionCount: group.decisionCount,
      supportCoverage: divide(
        group.supportedDecisionCount,
        group.decisionCount,
      ),
      rawLogLoss: divide(group.rawLogLossSum, group.decisionCount),
      major: group.decisionCount >= majorGroupMinDecisions,
    }))
    .sort(
      (left, right) =>
        left.type.localeCompare(right.type) ||
        left.value.localeCompare(right.value),
    );
  return {
    bySplit,
    selection,
    probabilityFloorSensitivity: {
      floors,
      maximumLogLossDelta,
    },
    groups,
  };
}

function finalizeMetrics(state) {
  return {
    decisionCount: state.decisionCount,
    candidateCount: state.candidateCount,
    candidateCoverage: divide(
      state.coveredDecisionCount,
      state.decisionCount,
    ),
    supportCoverage: divide(
      state.supportedDecisionCount,
      state.decisionCount,
    ),
    top1Rate: divide(state.top1Count, state.decisionCount),
    rawLogLoss: divide(state.rawLogLossSum, state.decisionCount),
    rawBrierScore: divide(state.rawBrierSum, state.decisionCount),
    meanEntropy: divide(state.entropySum, state.decisionCount),
    meanObservedRawProbability: divide(
      state.observedProbabilitySum,
      state.decisionCount,
    ),
    minimumObservedRawProbability:
      state.decisionCount === 0 ? 0 : state.minimumObservedRawProbability,
    maximumCandidateProbability: state.maximumCandidateProbability,
    extremeCandidateProbabilityRate: divide(
      state.extremeCandidateProbabilityCount,
      state.candidateCount,
    ),
  };
}

function buildReleaseGate(metrics, majorGroupMinDecisions) {
  const majorLowSupportGroups = metrics.groups.filter(
    (group) => group.major && group.supportCoverage < 0.75,
  );
  const reasons = [];
  if (metrics.selection.candidateCoverage < 0.99) {
    reasons.push('Candidate coverage is below 99%.');
  }
  if (metrics.selection.supportCoverage < 0.9) {
    reasons.push('Behavior support coverage is below 90%.');
  }
  if (majorLowSupportGroups.length > 0) {
    reasons.push('At least one major cohort has behavior support below 75%.');
  }
  if (metrics.selection.extremeCandidateProbabilityRate > 0.01) {
    reasons.push('Behavioral probabilities collapsed near 0 or 1.');
  }
  if (metrics.probabilityFloorSensitivity.maximumLogLossDelta > 0.02) {
    reasons.push('Behavioral result is unstable across probability floors.');
  }
  return {
    passed: reasons.length === 0,
    candidateCoverage: metrics.selection.candidateCoverage,
    minimumCandidateCoverage: 0.99,
    behaviorSupportCoverage: metrics.selection.supportCoverage,
    minimumBehaviorSupportCoverage: 0.9,
    minimumMajorGroupSupportCoverage: 0.75,
    majorGroupMinDecisions,
    majorLowSupportGroups,
    extremeCandidateProbabilityRate:
      metrics.selection.extremeCandidateProbabilityRate,
    maximumExtremeCandidateProbabilityRate: 0.01,
    probabilityFloorMaximumLogLossDelta:
      metrics.probabilityFloorSensitivity.maximumLogLossDelta,
    maximumProbabilityFloorLogLossDelta: 0.02,
    reasons,
  };
}

function architectureContinuation(preferred, baseline) {
  const baselineMetrics = comparableMetrics(baseline);
  const checks = {
    supportCoverageImprovement:
      preferred.supportCoverage - baselineMetrics.supportCoverage >= 0.05,
    rawLogLossWithinBound:
      preferred.rawLogLoss <= baselineMetrics.rawLogLoss + 0.02,
    majorLowSupportGroupReduction:
      preferred.majorLowSupportGroupCount <
      baselineMetrics.majorLowSupportGroupCount,
    structuralAuditPassed: preferred.structuralAuditPassed === true,
    rawPropensityContract:
      RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT ===
      'RAW_SOFTMAX_WITHIN_DECISION',
  };
  const reasons = Object.entries(checks)
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);
  return {
    passed: reasons.length === 0,
    checks,
    reasons,
  };
}

function comparableMetrics(result) {
  return {
    supportCoverage:
      result.behaviorSupportCoverage ?? result.supportCoverage,
    rawLogLoss:
      result.selectionMetrics?.rawLogLoss ?? result.rawLogLoss,
    top1Rate:
      result.selectionMetrics?.top1Rate ?? result.top1Rate,
    floorSensitivityDelta:
      result.probabilityFloorMaximumLogLossDelta ?? result.floorSensitivityDelta,
    majorLowSupportGroupCount: result.majorLowSupportGroupCount,
  };
}

function compareVariants(left, right) {
  return (
    compareBooleanDesc(left.releaseGatePassed, right.releaseGatePassed) ||
    compareNumberAsc(
      left.majorLowSupportGroupCount,
      right.majorLowSupportGroupCount,
    ) ||
    compareNumberDesc(left.supportCoverage, right.supportCoverage) ||
    compareNumberAsc(left.rawLogLoss, right.rawLogLoss) ||
    compareNumberDesc(left.top1Rate, right.top1Rate) ||
    compareNumberAsc(left.floorSensitivityDelta, right.floorSensitivityDelta) ||
    compareNumberAsc(left.modelByteLength, right.modelByteLength) ||
    left.variant.localeCompare(right.variant)
  );
}

function compareBooleanDesc(left, right) {
  return Number(Boolean(right)) - Number(Boolean(left));
}

function compareNumberAsc(left, right) {
  return finiteNumber(left) - finiteNumber(right);
}

function compareNumberDesc(left, right) {
  return finiteNumber(right) - finiteNumber(left);
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

async function loadDiagnosticSample(path) {
  const rows = [];
  let line = 0;
  const input = createInterface({
    input: await openMaybeGzipNdjsonReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const text of input) {
    if (!text.trim()) {
      continue;
    }
    line += 1;
    const row = JSON.parse(text);
    validateSampleRow(row, line);
    rows.push(row);
  }
  return rows;
}

function validateSampleRow(row, line) {
  if (
    !row ||
    typeof row !== 'object' ||
    row.schemaVersion !== 1 ||
    row.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2' ||
    row.dataSource !== 'PRO_HISTORICAL' ||
    !['TRAIN', 'TUNING'].includes(row.split) ||
    typeof row.decisionId !== 'string' ||
    typeof row.matchId !== 'string' ||
    !Array.isArray(row.candidates) ||
    row.candidates.length < 2 ||
    row.observedActionInCandidateSet !== true ||
    row.eligibility?.behavioralModel !== true ||
    row.candidates.some((candidate) => candidate.catalogMetadataAvailable !== true)
  ) {
    throw new Error(`Invalid Behavioral V5.2 diagnostic sample row ${line}.`);
  }
}

function validateFoldCoverage(rows, foldCount) {
  const matches = Array.from({ length: foldCount }, () => new Set());
  for (const row of rows) {
    matches[recommendationBehavioralV52FoldId(row.matchId, foldCount)].add(
      row.matchId,
    );
  }
  if (matches.some((value) => value.size === 0)) {
    throw new Error('Every Behavioral V5.2 MATCH fold needs TRAIN matches.');
  }
}

function assertRawPrediction(prediction) {
  if (
    !prediction ||
    prediction.candidates.length < 2 ||
    !Number.isFinite(prediction.observedActionProbability) ||
    prediction.observedActionProbability <= 0
  ) {
    throw new Error('Behavioral V5.2 produced an invalid prediction.');
  }
  const total = prediction.candidates.reduce(
    (sum, candidate) => sum + candidate.probability,
    0,
  );
  if (
    prediction.candidates.some(
      (candidate) =>
        !Number.isFinite(candidate.probability) || candidate.probability <= 0,
    ) ||
    Math.abs(total - 1) > 1e-9
  ) {
    throw new Error('Behavioral V5.2 candidate probabilities are not raw softmax.');
  }
}

function validateDatasetSource(manifest, audit) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2' ||
    manifest.auditPassed !== true ||
    manifest.trainingArtifactEligible !== true ||
    audit.passed !== true ||
    audit.trainingArtifactEligible !== true ||
    manifest.featureContract?.userLiveUsedAsInput !== false ||
    manifest.featureContract?.futureTestEligibleForSelection !== false
  ) {
    throw new Error('Dataset V6 is not eligible for Behavioral V5.2.');
  }
}

function validateV51SweepSummary(summary) {
  assertEqual(
    summary.operation,
    'RECOMMENDATION_BEHAVIORAL_V5_1_BOUNDED_SWEEP',
    'V5.1 sweep operation',
  );
  assertEqual(summary.expectedSourceSha256, expectedDatasetSha256, 'V5.1 source SHA');
  assertEqual(summary.diagnosticSample?.unit, 'MATCH', 'V5.1 sample unit');
  assertEqual(summary.diagnosticSample?.hash, 'FNV1A_32', 'V5.1 sample hash');
  assertEqual(summary.diagnosticSample?.modulo, 16, 'V5.1 sample modulo');
  assertEqual(summary.diagnosticSample?.remainder, 0, 'V5.1 sample remainder');
  assertEqual(
    summary.diagnosticSample?.sha256,
    expectedSampleSha256,
    'V5.1 sample SHA',
  );
  assertEqual(
    summary.diagnosticSample?.futureTestEvaluated,
    false,
    'V5.1 FUTURE_TEST policy',
  );
  assertEqual(summary.valueV8TrainingAuthorized, false, 'V5.1 Value authorization');
}

function requiredPreferredV51Result(summary) {
  const result = summary.results?.find(
    (value) => value.variant === summary.preferredDiagnosticVariant,
  );
  if (!result) {
    throw new Error('Preferred V5.1 bounded result is missing.');
  }
  return result;
}

function economyBand(netWorth) {
  if (!Number.isFinite(netWorth)) {
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

function renderReport(summary) {
  const lines = [
    'Recommendation Behavioral V5.2 bounded architecture sweep',
    `generatedAt=${summary.generatedAt}`,
    `datasetSha256=${summary.source.datasetSha256}`,
    `diagnosticSampleSha256=${summary.source.sampleSha256}`,
    `sampleRows=${summary.source.sampleRowCount}`,
    `trainRows=${summary.source.trainRowCount}`,
    `tuningRows=${summary.source.tuningRowCount}`,
    `preferredVariant=${summary.preferredVariant}`,
    `architectureContinuationRecommended=${summary.architectureContinuationRecommended}`,
    '',
  ];
  for (const result of summary.results) {
    lines.push(
      [
        `variant=${result.variant}`,
        `support=${result.supportCoverage}`,
        `rawLogLoss=${result.rawLogLoss}`,
        `top1=${result.top1Rate}`,
        `floorDelta=${result.floorSensitivityDelta}`,
        `majorLowSupportGroups=${result.majorLowSupportGroupCount}`,
        `releaseGatePassed=${result.releaseGatePassed}`,
        `structuralAuditPassed=${result.structuralAuditPassed}`,
        `modelByteLength=${result.modelByteLength}`,
      ].join(' '),
    );
  }
  lines.push('', `continuationReasons=${summary.continuationReasons.join(',') || 'none'}`);
  lines.push('fullTrainingAuthorized=false');
  lines.push('valueV8TrainingAuthorized=false');
  lines.push('productionRankingChanged=false');
  lines.push('passiveShadowAuthorized=false');
  lines.push('randomizedCanaryAuthorized=false');
  return `${lines.join('\n')}\n`;
}

async function requiredJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function atomicJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
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

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function divide(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}
