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

const requestPath = requiredString('BEHAVIORAL_V5_2_REFINEMENT_REQUEST_PATH');
const sourceDirectory = requiredString('DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_2_SOURCE_DIR');
const samplePath = requiredString('BEHAVIORAL_V5_2_SAMPLE_PATH');
const sourceSweepSummaryPath = requiredString('BEHAVIORAL_V5_2_SOURCE_SWEEP_SUMMARY_PATH');
const outputDirectory = requiredString('BEHAVIORAL_V5_2_REFINEMENT_OUTPUT_DIR');
const expectedDatasetSha256 = requiredSha256('EXPECTED_DATASET_SHA256');
const expectedSampleSha256 = requiredSha256('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');
const expectedSourceSweepSummarySha256 = requiredSha256('EXPECTED_SOURCE_SWEEP_SUMMARY_SHA256');

const request = await requiredJson(requestPath);
validateRequest(request);

const datasetManifest = await requiredJson(join(sourceDirectory, 'manifest.json'));
const datasetAudit = await requiredJson(join(sourceDirectory, 'audit.json'));
validateDatasetSource(datasetManifest, datasetAudit);
const datasetArtifactPath = join(sourceDirectory, datasetManifest.artifact.fileName);
assertEqual(await hashFile(datasetArtifactPath), expectedDatasetSha256, 'Dataset V6 artifact SHA-256');
assertEqual(datasetManifest.artifact.sha256, expectedDatasetSha256, 'Dataset V6 manifest SHA-256');
assertEqual(await hashFile(samplePath), expectedSampleSha256, 'diagnostic sample SHA-256');

const sourceSummaryRaw = await readFile(sourceSweepSummaryPath);
assertEqual(sha256(sourceSummaryRaw), expectedSourceSweepSummarySha256, 'source V5.2 sweep summary SHA-256');
const sourceSummary = JSON.parse(sourceSummaryRaw.toString('utf8'));
const sourceWinner = validateSourceSummary(sourceSummary);
validateRefinementVariants(request.variants, sourceWinner.configuration);

const sampleRows = await loadSample(samplePath);
const eligibleRows = sampleRows.filter(isBehavioralEligible);
const trainRows = eligibleRows.filter((row) => row.split === 'TRAIN');
const tuningRows = eligibleRows.filter((row) => row.split === 'TUNING');
if (trainRows.length === 0 || tuningRows.length === 0) {
  throw new Error('Behavioral V5.2 refinement requires eligible TRAIN and TUNING rows.');
}
validateFoldCoverage(trainRows, request.common.foldCount);

await mkdir(outputDirectory, { recursive: true });
const results = [];
for (const variant of request.variants) {
  const variantDirectory = join(outputDirectory, variant.id.toLowerCase());
  await mkdir(variantDirectory, { recursive: true });
  results.push(
    await runVariant(variant, variantDirectory, trainRows, tuningRows, request.common),
  );
}

const preferred = [...results].sort(compareVariants)[0];
const refinementChecks = {
  structuralAuditPassed: preferred.structuralAuditPassed === true,
  rawPropensityContract:
    RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT === 'RAW_SOFTMAX_WITHIN_DECISION',
  supportNotRegressed:
    preferred.supportCoverage >= sourceWinner.supportCoverage - 0.01,
  rawLogLossNotRegressed:
    preferred.rawLogLoss <= sourceWinner.rawLogLoss + 0.02,
  majorLowSupportNotRegressed:
    preferred.majorLowSupportGroupCount <= sourceWinner.majorLowSupportGroupCount,
};
const fullTrainingCandidatePrepared = Object.values(refinementChecks).every(Boolean);

const summary = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V5_2_BOUNDED_REFINEMENT',
  generatedAt: new Date().toISOString(),
  architecture: 'LOW_RANK_TWO_TOWER_CONDITIONAL_CHOICE',
  source: {
    datasetSha256: expectedDatasetSha256,
    pinnedSampleSha256: expectedSampleSha256,
    sourceSweepSummarySha256: expectedSourceSweepSummarySha256,
    sourcePreferredVariant: sourceSummary.preferredVariant,
    sourceConfiguration: sourceWinner.configuration,
    sourceMetrics: comparableMetrics(sourceWinner),
    sampleRowCount: sampleRows.length,
    eligibleRowCount: eligibleRows.length,
    trainRowCount: trainRows.length,
    tuningRowCount: tuningRows.length,
    futureTestRowCount: 0,
    sampleContract: {
      unit: 'MATCH',
      hash: 'FNV1A_32',
      modulo: 16,
      remainder: 0,
      futureTestEvaluated: false,
    },
  },
  refinementContract: {
    onlyEmbeddingHashLatentLearningRateEpochsMayVary: true,
    linearHashDimensionFixed: sourceWinner.configuration.linearHashDimension,
    foldCount: request.common.foldCount,
    l2: request.common.l2,
    supportProbability: request.common.supportProbability,
    majorGroupMinDecisions: request.common.majorGroupMinDecisions,
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
  preferredConfiguration: preferred.configuration,
  refinementChecks,
  fullTrainingCandidatePrepared,
  boundedRefinementAuthorized: true,
  fullTrainingAuthorized: false,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
  results,
};
await atomicJson(join(outputDirectory, 'refinement-summary.json'), summary);
await writeFile(join(outputDirectory, 'refinement-report.txt'), renderReport(summary), 'utf8');
console.log(JSON.stringify(summary, null, 2));

async function runVariant(variant, variantDirectory, trainRows, tuningRows, common) {
  const config = {
    linearHashDimension: variant.linearHashDimension,
    embeddingHashDimension: variant.embeddingHashDimension,
    latentDimension: variant.latentDimension,
  };
  const foldRows = Array.from({ length: common.foldCount }, () => []);
  for (const row of trainRows) {
    foldRows[recommendationBehavioralV52FoldId(row.matchId, common.foldCount)].push(row);
  }

  const foldModels = [];
  for (let holdoutFoldId = 0; holdoutFoldId < common.foldCount; holdoutFoldId += 1) {
    const model = createRecommendationBehavioralV52Model(config);
    for (let epoch = 0; epoch < variant.epochs; epoch += 1) {
      for (let foldId = 0; foldId < foldRows.length; foldId += 1) {
        if (foldId === holdoutFoldId) continue;
        for (const row of foldRows[foldId]) {
          trainRecommendationBehavioralV52Decision(model, row, {
            learningRate: variant.learningRate,
            l2: common.l2,
          });
        }
      }
      await tick();
    }
    foldModels.push(model);
  }

  const finalModel = createRecommendationBehavioralV52Model(config);
  for (let epoch = 0; epoch < variant.epochs; epoch += 1) {
    for (const row of trainRows) {
      trainRecommendationBehavioralV52Decision(finalModel, row, {
        learningRate: variant.learningRate,
        l2: common.l2,
      });
    }
    await tick();
  }

  const accumulator = createAccumulator([0.005, 0.01, 0.02]);
  for (const row of trainRows) {
    const foldId = recommendationBehavioralV52FoldId(row.matchId, common.foldCount);
    observePrediction(
      accumulator,
      row,
      predictRecommendationBehavioralV52(foldModels[foldId], row),
      common.supportProbability,
    );
  }
  for (const row of tuningRows) {
    observePrediction(
      accumulator,
      row,
      predictRecommendationBehavioralV52(finalModel, row),
      common.supportProbability,
    );
  }

  const metrics = finalizeAccumulator(accumulator, common.majorGroupMinDecisions);
  const releaseGate = buildReleaseGate(metrics, common.majorGroupMinDecisions);
  const structuralAuditPassed = foldRows.every((rows) => rows.length > 0);
  const configuration = {
    ...variant,
    foldCount: common.foldCount,
    l2: common.l2,
    supportProbability: common.supportProbability,
    majorGroupMinDecisions: common.majorGroupMinDecisions,
  };
  const modelArtifact = {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
    generatedAt: new Date().toISOString(),
    diagnosticOnly: true,
    sourceDatasetSha256: expectedDatasetSha256,
    diagnosticSampleSha256: expectedSampleSha256,
    configuration,
    trainingContract: {
      architecture: 'LINEAR_RESIDUAL_PLUS_LOW_RANK_TWO_TOWER',
      normalization: 'SOFTMAX_WITHIN_DECISION',
      propensityOutput: RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
      candidateProbabilityFloorApplied: false,
      ipsClippingApplied: false,
      probabilityFloorSensitivity: 'OBSERVED_PROPENSITY_CLIP_ONLY',
      crossFittingUnit: 'MATCH',
      trainSplitOnly: true,
      tuningUsedForTraining: false,
      futureTestUsedForTraining: false,
      futureTestUsedForSelection: false,
    },
    finalModel,
  };
  const modelPath = join(variantDirectory, 'model.json');
  await atomicJson(modelPath, modelArtifact);
  const evaluationPath = join(variantDirectory, 'evaluation.json');
  await atomicJson(evaluationPath, {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    metrics,
    releaseGate,
    futureTestPolicy: {
      reported: false,
      usedForTraining: false,
      usedForSelection: false,
      evaluated: false,
    },
  });
  const auditPath = join(variantDirectory, 'audit.json');
  await atomicJson(auditPath, {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    passed: structuralAuditPassed,
    diagnosticOnly: true,
    trainingArtifactEligible: false,
    releaseGate,
  });
  const modelByteLength = (await stat(modelPath)).size;
  const manifest = {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
    sourceDatasetSha256: expectedDatasetSha256,
    diagnosticSampleSha256: expectedSampleSha256,
    diagnosticOnly: true,
    auditPassed: structuralAuditPassed,
    releaseGatePassed: releaseGate.passed,
    trainingArtifactEligible: false,
    trainingContract: modelArtifact.trainingContract,
    artifacts: {
      model: { fileName: 'model.json', sha256: await hashFile(modelPath), byteLength: modelByteLength },
      evaluation: { fileName: 'evaluation.json', sha256: await hashFile(evaluationPath) },
      audit: { fileName: 'audit.json', sha256: await hashFile(auditPath) },
    },
  };
  await atomicJson(join(variantDirectory, 'manifest.json'), manifest);
  return {
    variant: variant.id,
    configuration,
    supportCoverage: metrics.selection.supportCoverage,
    rawLogLoss: metrics.selection.rawLogLoss,
    top1Rate: metrics.selection.top1Rate,
    minimumObservedRawProbability: metrics.selection.minimumObservedRawProbability,
    floorSensitivityDelta: metrics.probabilityFloorSensitivity.maximumLogLossDelta,
    extremeCandidateProbabilityRate: metrics.selection.extremeCandidateProbabilityRate,
    majorLowSupportGroupCount: releaseGate.majorLowSupportGroups.length,
    candidateCoverage: metrics.selection.candidateCoverage,
    releaseGatePassed: releaseGate.passed,
    structuralAuditPassed,
    trainingArtifactEligible: false,
    modelByteLength,
  };
}

function createAccumulator(probabilityFloors) {
  return {
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
    observedProbabilitySum: 0,
    minimumObservedRawProbability: Number.POSITIVE_INFINITY,
    extremeCandidateProbabilityCount: 0,
  };
}

function observePrediction(accumulator, row, prediction, supportProbability) {
  assertRawPrediction(prediction);
  const state = accumulator.selection;
  const supported = prediction.observedActionProbability >= supportProbability;
  state.decisionCount += 1;
  state.candidateCount += row.candidates.length;
  state.coveredDecisionCount += prediction.candidates.some((candidate) => candidate.actionKey === row.observedActionKey) ? 1 : 0;
  state.supportedDecisionCount += supported ? 1 : 0;
  state.top1Count += prediction.topActionKey === row.observedActionKey ? 1 : 0;
  state.rawLogLossSum += -Math.log(Math.max(prediction.observedActionProbability, 1e-15));
  state.observedProbabilitySum += prediction.observedActionProbability;
  state.minimumObservedRawProbability = Math.min(state.minimumObservedRawProbability, prediction.observedActionProbability);
  for (const candidate of prediction.candidates) {
    state.extremeCandidateProbabilityCount += candidate.probability <= 1e-6 || candidate.probability >= 1 - 1e-6 ? 1 : 0;
  }

  const observedCandidate = row.candidates.find((candidate) => candidate.actionKey === row.observedActionKey);
  for (const [type, value] of [
    ['HERO', String(row.state.heroId)],
    ['TIME_BUCKET', String(Math.floor(row.state.gameTimeS / 300))],
    ['ITEM_TIER', String(observedCandidate?.tier ?? 'UNKNOWN')],
    ['ECONOMY_BAND', economyBand(row.state.netWorth)],
  ]) {
    const key = `${type}:${value}`;
    const group = accumulator.groups.get(key) ?? { type, value, decisionCount: 0, supportedDecisionCount: 0 };
    group.decisionCount += 1;
    group.supportedDecisionCount += supported ? 1 : 0;
    accumulator.groups.set(key, group);
  }

  for (const floor of accumulator.probabilityFloors) {
    const clipped = stabilizeRecommendationBehavioralV52ObservedProbability(prediction.observedActionProbability, floor);
    accumulator.floorLogLossSums.set(
      floor,
      accumulator.floorLogLossSums.get(floor) - Math.log(Math.max(clipped, 1e-15)),
    );
  }
}

function finalizeAccumulator(accumulator, majorGroupMinDecisions) {
  const selection = finalizeMetrics(accumulator.selection);
  const floorLosses = [...accumulator.floorLogLossSums.entries()].map(([floor, sum]) => ({
    floor,
    logLoss: divide(sum, selection.decisionCount),
  }));
  const losses = floorLosses.map((value) => value.logLoss).filter(Number.isFinite);
  const groups = [...accumulator.groups.values()].map((group) => ({
    ...group,
    supportCoverage: divide(group.supportedDecisionCount, group.decisionCount),
    major: group.decisionCount >= majorGroupMinDecisions,
  }));
  return {
    selection,
    groups,
    probabilityFloorSensitivity: {
      floors: floorLosses,
      maximumLogLossDelta: losses.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...losses) - Math.min(...losses),
    },
  };
}

function finalizeMetrics(state) {
  return {
    decisionCount: state.decisionCount,
    candidateCount: state.candidateCount,
    candidateCoverage: divide(state.coveredDecisionCount, state.decisionCount),
    supportCoverage: divide(state.supportedDecisionCount, state.decisionCount),
    top1Rate: divide(state.top1Count, state.decisionCount),
    rawLogLoss: divide(state.rawLogLossSum, state.decisionCount),
    meanObservedRawProbability: divide(state.observedProbabilitySum, state.decisionCount),
    minimumObservedRawProbability: state.decisionCount === 0 ? 0 : state.minimumObservedRawProbability,
    extremeCandidateProbabilityRate: divide(state.extremeCandidateProbabilityCount, state.candidateCount),
  };
}

function buildReleaseGate(metrics, majorGroupMinDecisions) {
  const majorLowSupportGroups = metrics.groups.filter((group) => group.major && group.supportCoverage < 0.75);
  const reasons = [];
  if (metrics.selection.candidateCoverage < 0.99) reasons.push('Candidate coverage is below 99%.');
  if (metrics.selection.supportCoverage < 0.9) reasons.push('Behavior support coverage is below 90%.');
  if (majorLowSupportGroups.length > 0) reasons.push('At least one major cohort has behavior support below 75%.');
  if (metrics.selection.extremeCandidateProbabilityRate > 0.01) reasons.push('Behavioral probabilities collapsed near 0 or 1.');
  if (metrics.probabilityFloorSensitivity.maximumLogLossDelta > 0.02) reasons.push('Behavioral result is unstable across probability floors.');
  return {
    passed: reasons.length === 0,
    candidateCoverage: metrics.selection.candidateCoverage,
    minimumCandidateCoverage: 0.99,
    behaviorSupportCoverage: metrics.selection.supportCoverage,
    minimumBehaviorSupportCoverage: 0.9,
    minimumMajorGroupSupportCoverage: 0.75,
    majorGroupMinDecisions,
    majorLowSupportGroups,
    extremeCandidateProbabilityRate: metrics.selection.extremeCandidateProbabilityRate,
    maximumExtremeCandidateProbabilityRate: 0.01,
    probabilityFloorMaximumLogLossDelta: metrics.probabilityFloorSensitivity.maximumLogLossDelta,
    maximumProbabilityFloorLogLossDelta: 0.02,
    reasons,
  };
}

async function loadSample(path) {
  const rows = [];
  const input = createInterface({ input: await openMaybeGzipNdjsonReadStream(path), crlfDelay: Infinity });
  let line = 0;
  for await (const text of input) {
    if (!text.trim()) continue;
    line += 1;
    const row = JSON.parse(text);
    if (
      !row ||
      typeof row !== 'object' ||
      row.schemaVersion !== 1 ||
      row.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2' ||
      row.dataSource !== 'PRO_HISTORICAL' ||
      !['TRAIN', 'TUNING'].includes(row.split) ||
      typeof row.decisionId !== 'string' ||
      typeof row.matchId !== 'string' ||
      !Array.isArray(row.candidates)
    ) {
      throw new Error(`Invalid Behavioral V5.2 refinement sample row ${line}.`);
    }
    rows.push(row);
  }
  return rows;
}

function isBehavioralEligible(row) {
  return (
    row.eligibility?.behavioralModel === true &&
    row.observedActionInCandidateSet === true &&
    row.candidates.length >= 2 &&
    row.candidates.every((candidate) => candidate.catalogMetadataAvailable === true)
  );
}

function validateSourceSummary(summary) {
  assertEqual(summary.schemaVersion, 2, 'source sweep schemaVersion');
  assertEqual(summary.executorVersion, 'ELIGIBILITY_FILTERED_2', 'source sweep executorVersion');
  assertEqual(summary.operation, 'RECOMMENDATION_BEHAVIORAL_V5_2_BOUNDED_ARCHITECTURE_SWEEP', 'source sweep operation');
  assertEqual(summary.architectureContinuationRecommended, true, 'source architecture continuation');
  assertEqual(summary.source?.datasetSha256, expectedDatasetSha256, 'source sweep Dataset SHA');
  assertEqual(summary.source?.pinnedSampleSha256, expectedSampleSha256, 'source sweep sample SHA');
  assertEqual(summary.source?.futureTestRowCount, 0, 'source sweep FUTURE_TEST row count');
  const winner = summary.results?.find((result) => result.variant === summary.preferredVariant);
  if (!winner || winner.structuralAuditPassed !== true) {
    throw new Error('Source V5.2 preferred bounded result is missing or structurally invalid.');
  }
  return winner;
}

function validateRequest(value) {
  if (
    value?.schemaVersion !== 1 ||
    value?.operation !== 'RECOMMENDATION_BEHAVIORAL_V5_2_BOUNDED_REFINEMENT' ||
    value?.boundedRefinementAuthorized !== true ||
    value?.maximumTrainingMinutes !== 20 ||
    value?.fullTrainingAuthorized !== false ||
    value?.valueV8TrainingAuthorized !== false ||
    value?.productionRankingChanged !== false ||
    value?.passiveShadowAuthorized !== false ||
    value?.randomizedCanaryAuthorized !== false ||
    !Array.isArray(value?.variants) ||
    value.variants.length !== 3 ||
    value?.common?.foldCount !== 5 ||
    value?.common?.l2 !== 0.0001 ||
    value?.common?.supportProbability !== 0.01 ||
    value?.common?.majorGroupMinDecisions !== 100
  ) {
    throw new Error('Invalid Behavioral V5.2 refinement request.');
  }
}

function validateRefinementVariants(variants, sourceConfiguration) {
  const ids = new Set();
  for (const variant of variants) {
    if (
      !variant ||
      typeof variant.id !== 'string' ||
      ids.has(variant.id) ||
      variant.linearHashDimension !== sourceConfiguration.linearHashDimension ||
      !Number.isSafeInteger(variant.embeddingHashDimension) ||
      variant.embeddingHashDimension < 128 ||
      variant.embeddingHashDimension > 32_768 ||
      !Number.isSafeInteger(variant.latentDimension) ||
      variant.latentDimension < 2 ||
      variant.latentDimension > 32 ||
      !Number.isSafeInteger(variant.epochs) ||
      variant.epochs < 1 ||
      variant.epochs > 8 ||
      !Number.isFinite(variant.learningRate) ||
      variant.learningRate < 0.005 ||
      variant.learningRate > 0.2
    ) {
      throw new Error(`Invalid Behavioral V5.2 refinement variant ${JSON.stringify(variant)}.`);
    }
    ids.add(variant.id);
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
    throw new Error('Dataset V6 is not eligible for Behavioral V5.2 refinement.');
  }
}

function validateFoldCoverage(rows, foldCount) {
  const folds = Array.from({ length: foldCount }, () => 0);
  for (const row of rows) folds[recommendationBehavioralV52FoldId(row.matchId, foldCount)] += 1;
  if (folds.some((count) => count === 0)) throw new Error('Every refinement MATCH fold needs TRAIN decisions.');
}

function assertRawPrediction(prediction) {
  const total = prediction.candidates.reduce((sum, candidate) => sum + candidate.probability, 0);
  if (
    prediction.candidates.length < 2 ||
    prediction.candidates.some((candidate) => !Number.isFinite(candidate.probability) || candidate.probability <= 0) ||
    Math.abs(total - 1) > 1e-9 ||
    !Number.isFinite(prediction.observedActionProbability) ||
    prediction.observedActionProbability <= 0
  ) {
    throw new Error('Behavioral V5.2 refinement produced an invalid raw-softmax prediction.');
  }
}

function compareVariants(left, right) {
  return (
    Number(Boolean(right.releaseGatePassed)) - Number(Boolean(left.releaseGatePassed)) ||
    left.majorLowSupportGroupCount - right.majorLowSupportGroupCount ||
    right.supportCoverage - left.supportCoverage ||
    left.rawLogLoss - right.rawLogLoss ||
    right.top1Rate - left.top1Rate ||
    left.floorSensitivityDelta - right.floorSensitivityDelta ||
    left.modelByteLength - right.modelByteLength ||
    left.variant.localeCompare(right.variant)
  );
}

function comparableMetrics(result) {
  return {
    supportCoverage: result.supportCoverage,
    rawLogLoss: result.rawLogLoss,
    top1Rate: result.top1Rate,
    floorSensitivityDelta: result.floorSensitivityDelta,
    majorLowSupportGroupCount: result.majorLowSupportGroupCount,
  };
}

function economyBand(netWorth) {
  if (!Number.isFinite(netWorth)) return 'UNKNOWN';
  if (netWorth < 5_000) return 'LT_5000';
  if (netWorth < 10_000) return '5000_9999';
  if (netWorth < 20_000) return '10000_19999';
  return 'GE_20000';
}

function renderReport(summary) {
  return `${[
    'Recommendation Behavioral V5.2 bounded refinement',
    `generatedAt=${summary.generatedAt}`,
    `sourceSweepSummarySha256=${summary.source.sourceSweepSummarySha256}`,
    `preferredVariant=${summary.preferredVariant}`,
    `fullTrainingCandidatePrepared=${summary.fullTrainingCandidatePrepared}`,
    ...summary.results.map((result) =>
      `variant=${result.variant} support=${result.supportCoverage} rawLogLoss=${result.rawLogLoss} top1=${result.top1Rate} floorDelta=${result.floorSensitivityDelta} majorLowSupportGroups=${result.majorLowSupportGroupCount}`,
    ),
    'fullTrainingAuthorized=false',
    'valueV8TrainingAuthorized=false',
    'productionRankingChanged=false',
    'passiveShadowAuthorized=false',
    'randomizedCanaryAuthorized=false',
  ].join('\n')}\n`;
}

async function requiredJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
async function atomicJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
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
function requiredSha256(name) {
  const value = requiredString(name);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a lowercase SHA-256 value.`);
  return value;
}
function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
}
function divide(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}
function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}
