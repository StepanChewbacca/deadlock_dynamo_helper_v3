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

const sourceDirectory = requiredString('DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_2_SOURCE_DIR');
const samplePath = requiredString('BEHAVIORAL_V5_2_SAMPLE_PATH');
const v51SweepSummaryPath = requiredString('BEHAVIORAL_V5_1_SWEEP_SUMMARY_PATH');
const outputDirectory = requiredString('BEHAVIORAL_V5_2_OUTPUT_DIR');
const expectedDatasetSha256 = requiredSha256('EXPECTED_DATASET_SHA256');
const expectedSampleSha256 = requiredSha256('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');
const expectedV51SweepSummarySha256 = requiredSha256('EXPECTED_V5_1_SWEEP_SUMMARY_SHA256');

const variants = [
  { id: 'A', linearHashDimension: 8192, embeddingHashDimension: 2048, latentDimension: 4, epochs: 3, learningRate: 0.1 },
  { id: 'B', linearHashDimension: 8192, embeddingHashDimension: 4096, latentDimension: 8, epochs: 4, learningRate: 0.08 },
  { id: 'C', linearHashDimension: 16384, embeddingHashDimension: 8192, latentDimension: 12, epochs: 4, learningRate: 0.05 },
];
const common = {
  foldCount: 5,
  l2: 0.0001,
  supportProbability: 0.01,
  propensityFloors: [0.005, 0.01, 0.02],
  majorGroupMinDecisions: 100,
};

const datasetManifest = JSON.parse(await readFile(join(sourceDirectory, 'manifest.json'), 'utf8'));
const datasetAudit = JSON.parse(await readFile(join(sourceDirectory, 'audit.json'), 'utf8'));
validateDatasetSource(datasetManifest, datasetAudit);
const datasetPath = join(sourceDirectory, datasetManifest.artifact.fileName);
assertEqual(await hashFile(datasetPath), expectedDatasetSha256, 'Dataset V6 artifact SHA-256');
assertEqual(datasetManifest.artifact.sha256, expectedDatasetSha256, 'Dataset V6 manifest SHA-256');
assertEqual(await hashFile(samplePath), expectedSampleSha256, 'diagnostic sample SHA-256');

const v51SummaryRaw = await readFile(v51SweepSummaryPath);
assertEqual(sha256(v51SummaryRaw), expectedV51SweepSummarySha256, 'V5.1 sweep summary SHA-256');
const v51Summary = JSON.parse(v51SummaryRaw.toString('utf8'));
validateV51Summary(v51Summary);
const v51Baseline = v51Summary.results?.find(
  (value) => value.variant === v51Summary.preferredDiagnosticVariant,
);
if (!v51Baseline) {
  throw new Error('Preferred V5.1 bounded result is missing.');
}

const sourceRows = await loadFullPinnedSample(samplePath);
const selectionRows = sourceRows.filter((row) => row.split === 'TRAIN' || row.split === 'TUNING');
const eligibleRows = selectionRows.filter(isBehavioralEligible);
const trainRows = eligibleRows.filter((row) => row.split === 'TRAIN');
const tuningRows = eligibleRows.filter((row) => row.split === 'TUNING');
const candidateCoverage = divide(
  selectionRows.filter((row) => row.observedActionInCandidateSet === true).length,
  selectionRows.length,
);
if (trainRows.length === 0 || tuningRows.length === 0) {
  throw new Error('Behavioral V5.2 bounded sample requires eligible TRAIN and TUNING rows.');
}
validateFoldCoverage(trainRows, common.foldCount);

await mkdir(outputDirectory, { recursive: true });
const results = [];
for (const variant of variants) {
  const result = await runVariant(variant, trainRows, tuningRows, candidateCoverage);
  results.push(result);
  await writeVariantArtifacts(result);
  console.log(JSON.stringify(result.summary, null, 2));
}

const ranked = [...results].sort((left, right) => compareResults(left.summary, right.summary));
const preferred = ranked[0].summary;
const baselineMetrics = comparableMetrics(v51Baseline);
const continuationChecks = {
  supportCoverageImprovement:
    preferred.supportCoverage - baselineMetrics.supportCoverage >= 0.05,
  rawLogLossWithinBound:
    preferred.rawLogLoss <= baselineMetrics.rawLogLoss + 0.02,
  majorLowSupportGroupReduction:
    preferred.majorLowSupportGroupCount < baselineMetrics.majorLowSupportGroupCount,
  structuralAuditPassed: preferred.structuralAuditPassed === true,
  rawPropensityContract:
    RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT === 'RAW_SOFTMAX_WITHIN_DECISION',
};
const continuationReasons = Object.entries(continuationChecks)
  .filter(([, passed]) => passed !== true)
  .map(([name]) => name);
const summary = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_BEHAVIORAL_V5_2_BOUNDED_ARCHITECTURE_SWEEP',
  executorVersion: 'ELIGIBILITY_FILTERED_2',
  generatedAt: new Date().toISOString(),
  architecture: 'LOW_RANK_TWO_TOWER_CONDITIONAL_CHOICE',
  source: {
    directory: sourceDirectory,
    datasetSha256: expectedDatasetSha256,
    pinnedSampleSha256: expectedSampleSha256,
    pinnedSampleRowCount: sourceRows.length,
    selectionRowCount: selectionRows.length,
    eligibleSelectionRowCount: eligibleRows.length,
    trainEligibleRowCount: trainRows.length,
    tuningEligibleRowCount: tuningRows.length,
    futureTestRowCount: sourceRows.filter((row) => row.split === 'FUTURE_TEST').length,
    eligibilityFilteringAppliedAfterPinnedSampleVerification: true,
    sampleContract: {
      inheritedFrom: 'RECOMMENDATION_BEHAVIORAL_V5_1_BOUNDED_SWEEP',
      unit: 'MATCH',
      hash: 'FNV1A_32',
      modulo: 16,
      remainder: 0,
      futureTestEvaluated: false,
    },
  },
  v51Baseline: {
    sweepSummarySha256: expectedV51SweepSummarySha256,
    preferredVariant: v51Summary.preferredDiagnosticVariant,
    metrics: baselineMetrics,
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
  architectureContinuationRecommended: continuationReasons.length === 0,
  continuationChecks,
  continuationReasons,
  boundedRefinementAuthorized: false,
  fullTrainingAuthorized: false,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
  results: results.map((value) => value.summary),
};
await writeJson(join(outputDirectory, 'sweep-summary.json'), summary);
await writeFile(join(outputDirectory, 'sweep-report.txt'), renderReport(summary), 'utf8');
console.log(JSON.stringify(summary, null, 2));

async function runVariant(variant, trainRows, tuningRows, candidateCoverage) {
  const modelConfig = {
    linearHashDimension: variant.linearHashDimension,
    embeddingHashDimension: variant.embeddingHashDimension,
    latentDimension: variant.latentDimension,
  };
  const foldRows = Array.from({ length: common.foldCount }, () => []);
  for (const row of trainRows) {
    foldRows[recommendationBehavioralV52FoldId(row.matchId, common.foldCount)].push(row);
  }
  const foldModels = [];
  for (let holdout = 0; holdout < common.foldCount; holdout += 1) {
    const model = createRecommendationBehavioralV52Model(modelConfig);
    for (let epoch = 0; epoch < variant.epochs; epoch += 1) {
      for (let fold = 0; fold < foldRows.length; fold += 1) {
        if (fold === holdout) continue;
        for (const row of foldRows[fold]) {
          trainRecommendationBehavioralV52Decision(model, row, {
            learningRate: variant.learningRate,
            l2: common.l2,
          });
        }
      }
      await tick();
    }
    assertEqual(
      model.trainedDecisionCount,
      (trainRows.length - foldRows[holdout].length) * variant.epochs,
      `${variant.id} fold ${holdout} training count`,
    );
    foldModels.push(model);
  }

  const finalModel = createRecommendationBehavioralV52Model(modelConfig);
  for (let epoch = 0; epoch < variant.epochs; epoch += 1) {
    for (const row of trainRows) {
      trainRecommendationBehavioralV52Decision(finalModel, row, {
        learningRate: variant.learningRate,
        l2: common.l2,
      });
    }
    await tick();
  }
  assertEqual(
    finalModel.trainedDecisionCount,
    trainRows.length * variant.epochs,
    `${variant.id} final training count`,
  );

  const acc = createAccumulator();
  for (const row of trainRows) {
    const foldId = recommendationBehavioralV52FoldId(row.matchId, common.foldCount);
    observe(acc, row, predictRecommendationBehavioralV52(foldModels[foldId], row));
  }
  for (const row of tuningRows) {
    observe(acc, row, predictRecommendationBehavioralV52(finalModel, row));
  }
  const metrics = finalizeAccumulator(acc);
  const majorLowSupportGroups = metrics.groups.filter(
    (group) => group.major && group.supportCoverage < 0.75,
  );
  const releaseReasons = [];
  if (candidateCoverage < 0.99) releaseReasons.push('Candidate coverage is below 99%.');
  if (metrics.selection.supportCoverage < 0.9) releaseReasons.push('Behavior support coverage is below 90%.');
  if (majorLowSupportGroups.length > 0) releaseReasons.push('At least one major cohort has behavior support below 75%.');
  if (metrics.selection.extremeCandidateProbabilityRate > 0.01) releaseReasons.push('Behavioral probabilities collapsed near 0 or 1.');
  if (metrics.probabilityFloorSensitivity.maximumLogLossDelta > 0.02) releaseReasons.push('Behavioral result is unstable across probability floors.');

  const modelArtifact = {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
    diagnosticOnly: true,
    sourceDatasetSha256: expectedDatasetSha256,
    pinnedSampleSha256: expectedSampleSha256,
    configuration: { ...variant, foldCount: common.foldCount, l2: common.l2 },
    trainingContract: {
      architecture: 'LINEAR_RESIDUAL_PLUS_LOW_RANK_TWO_TOWER',
      propensityOutput: 'RAW_SOFTMAX_WITHIN_DECISION',
      candidateProbabilityFloorApplied: false,
      ipsClippingApplied: false,
      probabilityFloorSensitivity: 'OBSERVED_PROPENSITY_CLIP_ONLY',
      crossFittingUnit: 'MATCH',
      trainSplitOnly: true,
      tuningUsedForTraining: false,
      futureTestUsedForTraining: false,
      futureTestUsedForSelection: false,
      outcomeFieldsUsed: false,
    },
    finalModel,
  };
  const modelBytes = Buffer.from(`${JSON.stringify(modelArtifact)}\n`);
  const modelSha256 = sha256(modelBytes);
  const releaseGatePassed = releaseReasons.length === 0;
  const structuralAuditPassed = true;
  return {
    modelArtifact,
    evaluation: {
      schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
      modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
      metrics,
      releaseGate: {
        passed: releaseGatePassed,
        candidateCoverage,
        behaviorSupportCoverage: metrics.selection.supportCoverage,
        majorLowSupportGroups,
        extremeCandidateProbabilityRate: metrics.selection.extremeCandidateProbabilityRate,
        probabilityFloorMaximumLogLossDelta: metrics.probabilityFloorSensitivity.maximumLogLossDelta,
        reasons: releaseReasons,
      },
      futureTestPolicy: {
        reported: false,
        evaluated: false,
        usedForTraining: false,
        usedForCalibration: false,
        usedForSelection: false,
      },
    },
    audit: {
      schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
      modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
      passed: structuralAuditPassed,
      trainingArtifactEligible: false,
      diagnosticOnly: true,
      source: {
        datasetSha256: expectedDatasetSha256,
        pinnedSampleSha256: expectedSampleSha256,
        trainEligibleDecisionCount: trainRows.length,
        tuningEligibleDecisionCount: tuningRows.length,
        futureTestDecisionCount: 0,
      },
      crossFitting: {
        unit: 'MATCH',
        foldCount: common.foldCount,
        foldDecisionCounts: foldRows.map((rows) => rows.length),
        oofPredictionCount: trainRows.length,
        trainingMatchExclusionVerified: true,
      },
      probabilityContract: {
        output: 'RAW_SOFTMAX_WITHIN_DECISION',
        candidateProbabilityFloorApplied: false,
        observedOnlyFloorSensitivity: true,
      },
      reasons: [],
    },
    summary: {
      variant: variant.id,
      configuration: modelArtifact.configuration,
      sourceDatasetSha256: expectedDatasetSha256,
      diagnosticSampleSha256: expectedSampleSha256,
      candidateCoverage,
      supportCoverage: metrics.selection.supportCoverage,
      rawLogLoss: metrics.selection.rawLogLoss,
      top1Rate: metrics.selection.top1Rate,
      meanObservedRawProbability: metrics.selection.meanObservedRawProbability,
      minimumObservedRawProbability: metrics.selection.minimumObservedRawProbability,
      floorSensitivityDelta: metrics.probabilityFloorSensitivity.maximumLogLossDelta,
      extremeCandidateProbabilityRate: metrics.selection.extremeCandidateProbabilityRate,
      majorLowSupportGroupCount: majorLowSupportGroups.length,
      releaseGatePassed,
      structuralAuditPassed,
      trainingArtifactEligible: false,
      modelByteLength: modelBytes.length,
      modelSha256,
      trainMetrics: metrics.bySplit.TRAIN,
      tuningMetrics: metrics.bySplit.TUNING,
      releaseReasons,
      structuralReasons: [],
    },
  };
}

async function writeVariantArtifacts(result) {
  const dir = join(outputDirectory, result.summary.variant.toLowerCase());
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, 'model.json'), result.modelArtifact);
  await writeJson(join(dir, 'evaluation.json'), result.evaluation);
  await writeJson(join(dir, 'audit.json'), result.audit);
  await writeJson(join(dir, 'manifest.json'), {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
    diagnosticOnly: true,
    sourceDatasetSha256: expectedDatasetSha256,
    diagnosticSampleSha256: expectedSampleSha256,
    auditPassed: result.summary.structuralAuditPassed,
    releaseGatePassed: result.summary.releaseGatePassed,
    trainingArtifactEligible: false,
    artifacts: {
      model: { fileName: 'model.json', sha256: await hashFile(join(dir, 'model.json')), byteLength: (await stat(join(dir, 'model.json'))).size },
      evaluation: { fileName: 'evaluation.json', sha256: await hashFile(join(dir, 'evaluation.json')) },
      audit: { fileName: 'audit.json', sha256: await hashFile(join(dir, 'audit.json')) },
    },
  });
}

function createAccumulator() {
  return {
    bySplit: { TRAIN: emptyMetrics(), TUNING: emptyMetrics() },
    selection: emptyMetrics(),
    groups: new Map(),
    floorLoss: new Map(common.propensityFloors.map((floor) => [floor, 0])),
  };
}
function emptyMetrics() {
  return { decisionCount: 0, candidateCount: 0, supportedCount: 0, top1Count: 0, rawLogLossSum: 0, observedProbabilitySum: 0, minimumObservedRawProbability: Number.POSITIVE_INFINITY, maximumCandidateProbability: 0, extremeCandidateProbabilityCount: 0 };
}
function observe(acc, row, prediction) {
  assertRawPrediction(prediction);
  const supported = prediction.observedActionProbability >= common.supportProbability;
  observeMetrics(acc.bySplit[row.split], row, prediction, supported);
  observeMetrics(acc.selection, row, prediction, supported);
  const observedCandidate = row.candidates.find((candidate) => candidate.actionKey === row.observedActionKey);
  const groups = [
    ['HERO', String(row.state.heroId)],
    ['TIME_BUCKET', String(Math.floor(row.state.gameTimeS / 300))],
    ['ITEM_TIER', String(observedCandidate?.tier ?? 'UNKNOWN')],
    ['ECONOMY_BAND', economyBand(row.state.netWorth)],
  ];
  const rawLogLoss = -Math.log(Math.max(prediction.observedActionProbability, 1e-15));
  for (const [type, value] of groups) {
    const key = `${type}:${value}`;
    const group = acc.groups.get(key) ?? { type, value, decisionCount: 0, supportedCount: 0, rawLogLossSum: 0 };
    group.decisionCount += 1;
    group.supportedCount += supported ? 1 : 0;
    group.rawLogLossSum += rawLogLoss;
    acc.groups.set(key, group);
  }
  for (const floor of common.propensityFloors) {
    const clipped = stabilizeRecommendationBehavioralV52ObservedProbability(prediction.observedActionProbability, floor);
    acc.floorLoss.set(floor, acc.floorLoss.get(floor) - Math.log(Math.max(clipped, 1e-15)));
  }
}
function observeMetrics(state, row, prediction, supported) {
  state.decisionCount += 1;
  state.candidateCount += row.candidates.length;
  state.supportedCount += supported ? 1 : 0;
  state.top1Count += prediction.topActionKey === row.observedActionKey ? 1 : 0;
  state.rawLogLossSum += -Math.log(Math.max(prediction.observedActionProbability, 1e-15));
  state.observedProbabilitySum += prediction.observedActionProbability;
  state.minimumObservedRawProbability = Math.min(state.minimumObservedRawProbability, prediction.observedActionProbability);
  state.maximumCandidateProbability = Math.max(state.maximumCandidateProbability, prediction.maximumProbability);
  for (const candidate of prediction.candidates) {
    state.extremeCandidateProbabilityCount += candidate.probability <= 1e-6 || candidate.probability >= 1 - 1e-6 ? 1 : 0;
  }
}
function finalizeAccumulator(acc) {
  const selection = finalizeMetrics(acc.selection);
  const floors = [...acc.floorLoss.entries()].map(([floor, sum]) => ({ floor, decisionCount: selection.decisionCount, logLoss: divide(sum, selection.decisionCount) }));
  const floorValues = floors.map((value) => value.logLoss);
  return {
    bySplit: { TRAIN: finalizeMetrics(acc.bySplit.TRAIN), TUNING: finalizeMetrics(acc.bySplit.TUNING) },
    selection,
    probabilityFloorSensitivity: { floors, maximumLogLossDelta: Math.max(...floorValues) - Math.min(...floorValues) },
    groups: [...acc.groups.values()].map((group) => ({
      type: group.type,
      value: group.value,
      decisionCount: group.decisionCount,
      supportCoverage: divide(group.supportedCount, group.decisionCount),
      rawLogLoss: divide(group.rawLogLossSum, group.decisionCount),
      major: group.decisionCount >= common.majorGroupMinDecisions,
    })),
  };
}
function finalizeMetrics(state) {
  return {
    decisionCount: state.decisionCount,
    candidateCount: state.candidateCount,
    supportCoverage: divide(state.supportedCount, state.decisionCount),
    top1Rate: divide(state.top1Count, state.decisionCount),
    rawLogLoss: divide(state.rawLogLossSum, state.decisionCount),
    meanObservedRawProbability: divide(state.observedProbabilitySum, state.decisionCount),
    minimumObservedRawProbability: state.decisionCount === 0 ? 0 : state.minimumObservedRawProbability,
    maximumCandidateProbability: state.maximumCandidateProbability,
    extremeCandidateProbabilityRate: divide(state.extremeCandidateProbabilityCount, state.candidateCount),
  };
}

async function loadFullPinnedSample(path) {
  const rows = [];
  const input = createInterface({ input: await openMaybeGzipNdjsonReadStream(path), crlfDelay: Infinity });
  let line = 0;
  for await (const text of input) {
    if (!text.trim()) continue;
    line += 1;
    const row = JSON.parse(text);
    validatePinnedSampleRow(row, line);
    if (row.split === 'FUTURE_TEST') {
      throw new Error('Pinned V5.1 diagnostic sample unexpectedly contains FUTURE_TEST.');
    }
    rows.push(row);
  }
  return rows;
}
function validatePinnedSampleRow(row, line) {
  if (!row || typeof row !== 'object' || row.schemaVersion !== 1 || row.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2' || row.dataSource !== 'PRO_HISTORICAL' || !['TRAIN', 'TUNING'].includes(row.split) || typeof row.decisionId !== 'string' || typeof row.matchId !== 'string' || !row.state || !Array.isArray(row.candidates) || !row.eligibility) {
    throw new Error(`Invalid pinned Behavioral V5.1 diagnostic sample row ${line}.`);
  }
}
function isBehavioralEligible(row) {
  return row.eligibility.behavioralModel === true && row.observedActionInCandidateSet === true && row.candidates.length >= 2 && row.candidates.every((candidate) => candidate.catalogMetadataAvailable === true);
}
function validateFoldCoverage(rows, foldCount) {
  const matches = Array.from({ length: foldCount }, () => new Set());
  for (const row of rows) matches[recommendationBehavioralV52FoldId(row.matchId, foldCount)].add(row.matchId);
  if (matches.some((value) => value.size === 0)) throw new Error('Every Behavioral V5.2 MATCH fold needs TRAIN matches.');
}
function assertRawPrediction(prediction) {
  const total = prediction.candidates.reduce((sum, candidate) => sum + candidate.probability, 0);
  if (prediction.candidates.length < 2 || prediction.candidates.some((candidate) => !Number.isFinite(candidate.probability) || candidate.probability <= 0) || Math.abs(total - 1) > 1e-9 || !Number.isFinite(prediction.observedActionProbability) || prediction.observedActionProbability <= 0) {
    throw new Error('Behavioral V5.2 candidate probabilities are not valid raw softmax.');
  }
}
function validateDatasetSource(manifest, audit) {
  if (manifest.schemaVersion !== 1 || manifest.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2' || manifest.auditPassed !== true || manifest.trainingArtifactEligible !== true || audit.passed !== true || audit.trainingArtifactEligible !== true || manifest.featureContract?.userLiveUsedAsInput !== false || manifest.featureContract?.futureTestEligibleForSelection !== false) {
    throw new Error('Dataset V6 is not eligible for Behavioral V5.2.');
  }
}
function validateV51Summary(summary) {
  assertEqual(summary.operation, 'RECOMMENDATION_BEHAVIORAL_V5_1_BOUNDED_SWEEP', 'V5.1 sweep operation');
  assertEqual(summary.expectedSourceSha256, expectedDatasetSha256, 'V5.1 source SHA');
  assertEqual(summary.diagnosticSample?.unit, 'MATCH', 'V5.1 sample unit');
  assertEqual(summary.diagnosticSample?.hash, 'FNV1A_32', 'V5.1 sample hash');
  assertEqual(summary.diagnosticSample?.modulo, 16, 'V5.1 sample modulo');
  assertEqual(summary.diagnosticSample?.remainder, 0, 'V5.1 sample remainder');
  assertEqual(summary.diagnosticSample?.sha256, expectedSampleSha256, 'V5.1 sample SHA');
  assertEqual(summary.diagnosticSample?.futureTestEvaluated, false, 'V5.1 FUTURE_TEST policy');
}
function comparableMetrics(result) {
  return {
    supportCoverage: result.behaviorSupportCoverage ?? result.supportCoverage,
    rawLogLoss: result.selectionMetrics?.rawLogLoss ?? result.rawLogLoss,
    top1Rate: result.selectionMetrics?.top1Rate ?? result.top1Rate,
    floorSensitivityDelta: result.probabilityFloorMaximumLogLossDelta ?? result.floorSensitivityDelta,
    majorLowSupportGroupCount: result.majorLowSupportGroupCount,
  };
}
function compareResults(left, right) {
  return Number(Boolean(right.releaseGatePassed)) - Number(Boolean(left.releaseGatePassed)) ||
    left.majorLowSupportGroupCount - right.majorLowSupportGroupCount ||
    right.supportCoverage - left.supportCoverage ||
    left.rawLogLoss - right.rawLogLoss ||
    right.top1Rate - left.top1Rate ||
    left.floorSensitivityDelta - right.floorSensitivityDelta ||
    left.modelByteLength - right.modelByteLength ||
    left.variant.localeCompare(right.variant);
}
function economyBand(netWorth) {
  if (!Number.isFinite(netWorth)) return 'UNKNOWN';
  if (netWorth < 5000) return 'LT_5000';
  if (netWorth < 10000) return '5000_9999';
  if (netWorth < 20000) return '10000_19999';
  return 'GE_20000';
}
function renderReport(summary) {
  const lines = [
    'Recommendation Behavioral V5.2 bounded architecture sweep v2',
    `generatedAt=${summary.generatedAt}`,
    `datasetSha256=${summary.source.datasetSha256}`,
    `pinnedSampleSha256=${summary.source.pinnedSampleSha256}`,
    `pinnedSampleRows=${summary.source.pinnedSampleRowCount}`,
    `eligibleSelectionRows=${summary.source.eligibleSelectionRowCount}`,
    `preferredVariant=${summary.preferredVariant}`,
    `architectureContinuationRecommended=${summary.architectureContinuationRecommended}`,
  ];
  for (const result of summary.results) lines.push(`variant=${result.variant} support=${result.supportCoverage} rawLogLoss=${result.rawLogLoss} top1=${result.top1Rate} floorDelta=${result.floorSensitivityDelta} majorLowSupportGroups=${result.majorLowSupportGroupCount} release=${result.releaseGatePassed}`);
  lines.push(`continuationReasons=${summary.continuationReasons.join(',') || 'none'}`);
  lines.push('boundedRefinementAuthorized=false', 'fullTrainingAuthorized=false', 'valueV8TrainingAuthorized=false', 'productionRankingChanged=false', 'passiveShadowAuthorized=false', 'randomizedCanaryAuthorized=false');
  return `${lines.join('\n')}\n`;
}
async function writeJson(path, value) { await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8'); }
async function hashFile(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function requiredString(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing required environment variable ${name}.`); return value; }
function requiredSha256(name) { const value = requiredString(name); if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a lowercase SHA-256 value.`); return value; }
function assertEqual(actual, expected, label) { if (actual !== expected) throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`); }
function divide(numerator, denominator) { return denominator === 0 ? 0 : numerator / denominator; }
function tick() { return new Promise((resolve) => setImmediate(resolve)); }
