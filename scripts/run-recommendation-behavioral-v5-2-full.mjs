import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';

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

const requestPath = requiredString('BEHAVIORAL_V5_2_FULL_REQUEST_PATH');
const sourceDirectory = requiredString('DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_2_SOURCE_DIR');
const outputDirectory = requiredString('DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_2_DIR');
const refinementSummaryPath = requiredString('BEHAVIORAL_V5_2_REFINEMENT_SUMMARY_PATH');
const evidencePath = requiredString('BEHAVIORAL_V5_2_FULL_EVIDENCE_PATH');
const expectedDatasetSha256 = requiredSha256('EXPECTED_DATASET_SHA256');
const expectedRefinementSummarySha256 = requiredSha256('EXPECTED_REFINEMENT_SUMMARY_SHA256');

const request = await requiredJson(requestPath);
validateRequest(request);
const configuration = request.selectedConfiguration;

const datasetManifest = await requiredJson(join(sourceDirectory, 'manifest.json'));
const datasetAudit = await requiredJson(join(sourceDirectory, 'audit.json'));
validateDataset(datasetManifest, datasetAudit);
const datasetPath = join(sourceDirectory, datasetManifest.artifact.fileName);
assertEqual(await hashFile(datasetPath), expectedDatasetSha256, 'Dataset V6 SHA-256');
assertEqual(datasetManifest.artifact.sha256, expectedDatasetSha256, 'Dataset V6 manifest SHA-256');

const refinementRaw = await readFile(refinementSummaryPath);
assertEqual(sha256(refinementRaw), expectedRefinementSummarySha256, 'refinement summary SHA-256');
const refinement = JSON.parse(refinementRaw.toString('utf8'));
validateRefinement(refinement, configuration);

await mkdir(outputDirectory, { recursive: true });
const foldCount = configuration.foldCount;
const foldModels = Array.from({ length: foldCount }, () =>
  createRecommendationBehavioralV52Model(configuration),
);
const finalModel = createRecommendationBehavioralV52Model(configuration);
const trainDecisionCountsByFold = Array.from({ length: foldCount }, () => 0);
let trainDecisionCount = 0;
let tuningDecisionCount = 0;
let futureTestDecisionCount = 0;
let scannedDecisionCount = 0;
let candidateCoverageDecisionCount = 0;
let candidateCoverageCoveredCount = 0;

for await (const row of datasetRows(datasetPath)) {
  scannedDecisionCount += 1;
  if (row.split === 'FUTURE_TEST') {
    futureTestDecisionCount += 1;
    continue;
  }
  candidateCoverageDecisionCount += 1;
  candidateCoverageCoveredCount +=
    row.observedActionInCandidateSet === true ? 1 : 0;
  if (!isBehavioralEligible(row)) continue;
  if (row.split === 'TRAIN') {
    trainDecisionCount += 1;
    trainDecisionCountsByFold[
      recommendationBehavioralV52FoldId(row.matchId, foldCount)
    ] += 1;
  } else if (row.split === 'TUNING') {
    tuningDecisionCount += 1;
  }
}
if (trainDecisionCount === 0 || tuningDecisionCount === 0) {
  throw new Error('Full Behavioral V5.2 requires eligible TRAIN and TUNING decisions.');
}
if (trainDecisionCountsByFold.some((count) => count === 0)) {
  throw new Error('Every Behavioral V5.2 full MATCH fold needs TRAIN decisions.');
}

for (let holdoutFoldId = 0; holdoutFoldId < foldCount; holdoutFoldId += 1) {
  const model = foldModels[holdoutFoldId];
  for (let epoch = 0; epoch < configuration.epochs; epoch += 1) {
    for await (const row of datasetRows(datasetPath)) {
      if (!isBehavioralEligible(row) || row.split !== 'TRAIN') continue;
      if (recommendationBehavioralV52FoldId(row.matchId, foldCount) === holdoutFoldId) continue;
      trainRecommendationBehavioralV52Decision(model, row, {
        learningRate: configuration.learningRate,
        l2: configuration.l2,
      });
    }
    await tick();
  }
}

for (let epoch = 0; epoch < configuration.epochs; epoch += 1) {
  for await (const row of datasetRows(datasetPath)) {
    if (!isBehavioralEligible(row) || row.split !== 'TRAIN') continue;
    trainRecommendationBehavioralV52Decision(finalModel, row, {
      learningRate: configuration.learningRate,
      l2: configuration.l2,
    });
  }
  await tick();
}

const accumulator = createAccumulator([0.005, 0.01, 0.02]);
const propensitiesPath = join(outputDirectory, 'propensities.ndjson.gz');
const partialPropensitiesPath = `${propensitiesPath}.partial`;
const fileOutput = createWriteStream(partialPropensitiesPath);
const gzip = createGzip({ level: 6 });
gzip.pipe(fileOutput);
let propensityRowCount = 0;

for await (const row of datasetRows(datasetPath)) {
  if (!isBehavioralEligible(row) || row.split === 'FUTURE_TEST') continue;
  const foldId =
    row.split === 'TRAIN'
      ? recommendationBehavioralV52FoldId(row.matchId, foldCount)
      : undefined;
  const prediction = predictRecommendationBehavioralV52(
    row.split === 'TRAIN' ? foldModels[foldId] : finalModel,
    row,
  );
  assertRawPrediction(prediction);
  observePrediction(
    accumulator,
    row,
    prediction,
    configuration.supportProbability,
  );
  const propensityRow = {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
    sourceDatasetSha256: expectedDatasetSha256,
    decisionId: row.decisionId,
    matchId: row.matchId,
    split: row.split,
    foldId,
    predictionSource:
      row.split === 'TRAIN' ? 'CROSS_FITTED_OOF' : 'FULL_TRAIN_MODEL',
    trainingMatchExcluded: true,
    observedActionKey: row.observedActionKey,
    observedActionRawProbability: prediction.observedActionProbability,
    observedActionProbability: prediction.observedActionProbability,
    propensityFloorApplied: false,
    candidates: prediction.candidates.map((candidate) => ({
      actionKey: candidate.actionKey,
      itemId: candidate.itemId,
      score: candidate.score,
      rawProbability: candidate.probability,
      probability: candidate.probability,
      rank: candidate.rank,
    })),
  };
  if (!gzip.write(`${JSON.stringify(propensityRow)}\n`)) await once(gzip, 'drain');
  propensityRowCount += 1;
}
gzip.end();
await once(fileOutput, 'close');
await rename(partialPropensitiesPath, propensitiesPath);

const metrics = finalizeAccumulator(accumulator, configuration.majorGroupMinDecisions);
metrics.selection.candidateCoverage = divide(
  candidateCoverageCoveredCount,
  candidateCoverageDecisionCount,
);
const releaseGate = buildReleaseGate(metrics, configuration.majorGroupMinDecisions);
const structuralAuditPassed =
  propensityRowCount === trainDecisionCount + tuningDecisionCount &&
  trainDecisionCountsByFold.every((count) => count > 0);
const trainingArtifactEligible = structuralAuditPassed && releaseGate.passed;
const generatedAt = new Date().toISOString();

const modelPath = join(outputDirectory, 'model.json');
const modelArtifact = {
  schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
  modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
  featureVersion: RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
  probabilityContract: RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
  generatedAt,
  diagnosticOnly: false,
  sourceDatasetSha256: expectedDatasetSha256,
  configuration,
  trainingContract: trainingContract(),
  finalModel,
};
await atomicJson(modelPath, modelArtifact);

const evaluationPath = join(outputDirectory, 'evaluation.json');
const evaluation = {
  schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
  modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
  generatedAt,
  metrics,
  releaseGate,
  futureTestPolicy: {
    reported: true,
    decisionCount: futureTestDecisionCount,
    usedForTraining: false,
    usedForCalibration: false,
    usedForSelection: false,
    evaluated: false,
  },
};
await atomicJson(evaluationPath, evaluation);

const auditPath = join(outputDirectory, 'audit.json');
const audit = {
  schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
  modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
  generatedAt,
  passed: structuralAuditPassed,
  trainingArtifactEligible,
  source: {
    datasetSha256: expectedDatasetSha256,
    scannedDecisionCount,
    trainDecisionCount,
    tuningDecisionCount,
    futureTestDecisionCount,
    propensityRowCount,
  },
  crossFitting: {
    unit: 'MATCH',
    foldCount,
    foldTrainDecisionCounts: trainDecisionCountsByFold,
    trainingMatchExclusionVerified: true,
  },
  predictions: {
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT,
    propensityFloorApplied: false,
  },
  build: {
    fullCorpus: true,
    diagnosticOnly: false,
  },
  releaseGate,
  reasons: structuralAuditPassed ? [] : ['Full Behavioral V5.2 structural audit failed.'],
};
await atomicJson(auditPath, audit);

const manifestPath = join(outputDirectory, 'manifest.json');
const manifest = {
  schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION,
  modelVersion: RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION,
  featureVersion: RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION,
  generatedAt,
  source: {
    directory: sourceDirectory,
    sha256: expectedDatasetSha256,
  },
  build: {
    fullCorpus: true,
    diagnosticOnly: false,
  },
  trainingContract: trainingContract(),
  options: configuration,
  artifacts: {
    model: await artifactDescriptor(modelPath),
    propensities: {
      ...(await artifactDescriptor(propensitiesPath, propensityRowCount)),
      compression: 'GZIP',
    },
    evaluation: await artifactDescriptor(evaluationPath),
    audit: await artifactDescriptor(auditPath),
  },
  auditPassed: structuralAuditPassed,
  releaseGatePassed: releaseGate.passed,
  trainingArtifactEligible,
};
await atomicJson(manifestPath, manifest);

const gateChecks = {
  structuralAuditPassed,
  releaseGatePassed: releaseGate.passed,
  trainingArtifactEligible,
  fullCorpus: true,
  candidateCoverage: releaseGate.candidateCoverage >= 0.99,
  behaviorSupportCoverage: releaseGate.behaviorSupportCoverage >= 0.9,
  noMajorLowSupportGroups: releaseGate.majorLowSupportGroups.length === 0,
  extremeCandidateProbabilityRate:
    releaseGate.extremeCandidateProbabilityRate <= 0.01,
  floorSensitivity:
    releaseGate.probabilityFloorMaximumLogLossDelta <= 0.02,
  rawSoftmaxPropensity: true,
  futureNotTraining: true,
  futureNotSelection: true,
  futureNotEvaluated: true,
  sourceDatasetShaMatches: true,
};
const evidence = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V5_2_FULL_TRAINING',
  generatedAt,
  sourceDirectory,
  outputDirectory,
  expectedDatasetSha256,
  expectedRefinementSummarySha256,
  selectedConfiguration: configuration,
  gateChecks,
  audit,
  evaluation,
  manifest,
  fullTrainingAuthorized: true,
  valueV8TrainingAuthorized: false,
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
  throw new Error(`Behavioral V5.2 full training gates failed: ${failedGates.join(', ')}.`);
}

function trainingContract() {
  return {
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
    futureTestEvaluated: false,
    outcomeFieldsUsed: false,
  };
}

async function* datasetRows(path) {
  const input = createInterface({
    input: await openMaybeGzipNdjsonReadStream(path),
    crlfDelay: Infinity,
  });
  let line = 0;
  for await (const text of input) {
    if (!text.trim()) continue;
    line += 1;
    let row;
    try {
      row = JSON.parse(text);
    } catch {
      throw new Error(`Invalid Dataset V6 JSON at line ${line}.`);
    }
    if (
      row?.schemaVersion !== 1 ||
      row?.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2' ||
      row?.dataSource !== 'PRO_HISTORICAL' ||
      typeof row?.decisionId !== 'string' ||
      typeof row?.matchId !== 'string' ||
      !['TRAIN', 'TUNING', 'FUTURE_TEST'].includes(row?.split) ||
      !Array.isArray(row?.candidates)
    ) {
      throw new Error(`Invalid Dataset V6 row at line ${line}.`);
    }
    yield row;
  }
}

function isBehavioralEligible(row) {
  return (
    row.eligibility?.behavioralModel === true &&
    row.observedActionInCandidateSet === true &&
    row.candidates.length >= 2 &&
    row.candidates.every((candidate) => candidate.catalogMetadataAvailable === true)
  );
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
    supportedDecisionCount: 0,
    top1Count: 0,
    rawLogLossSum: 0,
    observedProbabilitySum: 0,
    minimumObservedRawProbability: Number.POSITIVE_INFINITY,
    extremeCandidateProbabilityCount: 0,
  };
}
function observePrediction(accumulator, row, prediction, supportProbability) {
  const supported = prediction.observedActionProbability >= supportProbability;
  const state = accumulator.selection;
  state.decisionCount += 1;
  state.candidateCount += row.candidates.length;
  state.supportedDecisionCount += supported ? 1 : 0;
  state.top1Count += prediction.topActionKey === row.observedActionKey ? 1 : 0;
  state.rawLogLossSum += -Math.log(Math.max(prediction.observedActionProbability, 1e-15));
  state.observedProbabilitySum += prediction.observedActionProbability;
  state.minimumObservedRawProbability = Math.min(
    state.minimumObservedRawProbability,
    prediction.observedActionProbability,
  );
  for (const candidate of prediction.candidates) {
    state.extremeCandidateProbabilityCount +=
      candidate.probability <= 1e-6 || candidate.probability >= 1 - 1e-6 ? 1 : 0;
  }
  const observedCandidate = row.candidates.find(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  for (const [type, value] of [
    ['HERO', String(row.state.heroId)],
    ['TIME_BUCKET', String(Math.floor(row.state.gameTimeS / 300))],
    ['ITEM_TIER', String(observedCandidate?.tier ?? 'UNKNOWN')],
    ['ECONOMY_BAND', economyBand(row.state.netWorth)],
  ]) {
    const key = `${type}:${value}`;
    const group = accumulator.groups.get(key) ?? {
      type,
      value,
      decisionCount: 0,
      supportedDecisionCount: 0,
    };
    group.decisionCount += 1;
    group.supportedDecisionCount += supported ? 1 : 0;
    accumulator.groups.set(key, group);
  }
  for (const floor of accumulator.probabilityFloors) {
    const clipped = stabilizeRecommendationBehavioralV52ObservedProbability(
      prediction.observedActionProbability,
      floor,
    );
    accumulator.floorLogLossSums.set(
      floor,
      accumulator.floorLogLossSums.get(floor) - Math.log(Math.max(clipped, 1e-15)),
    );
  }
}
function finalizeAccumulator(accumulator, majorGroupMinDecisions) {
  const selection = {
    decisionCount: accumulator.selection.decisionCount,
    candidateCount: accumulator.selection.candidateCount,
    candidateCoverage: 0,
    supportCoverage: divide(
      accumulator.selection.supportedDecisionCount,
      accumulator.selection.decisionCount,
    ),
    top1Rate: divide(
      accumulator.selection.top1Count,
      accumulator.selection.decisionCount,
    ),
    rawLogLoss: divide(
      accumulator.selection.rawLogLossSum,
      accumulator.selection.decisionCount,
    ),
    meanObservedRawProbability: divide(
      accumulator.selection.observedProbabilitySum,
      accumulator.selection.decisionCount,
    ),
    minimumObservedRawProbability:
      accumulator.selection.decisionCount === 0
        ? 0
        : accumulator.selection.minimumObservedRawProbability,
    extremeCandidateProbabilityRate: divide(
      accumulator.selection.extremeCandidateProbabilityCount,
      accumulator.selection.candidateCount,
    ),
  };
  const floors = [...accumulator.floorLogLossSums.entries()].map(([floor, sum]) => ({
    floor,
    logLoss: divide(sum, selection.decisionCount),
  }));
  const losses = floors.map((value) => value.logLoss).filter(Number.isFinite);
  const groups = [...accumulator.groups.values()].map((group) => ({
    ...group,
    supportCoverage: divide(group.supportedDecisionCount, group.decisionCount),
    major: group.decisionCount >= majorGroupMinDecisions,
  }));
  return {
    selection,
    groups,
    probabilityFloorSensitivity: {
      floors,
      maximumLogLossDelta:
        losses.length === 0
          ? Number.POSITIVE_INFINITY
          : Math.max(...losses) - Math.min(...losses),
    },
  };
}
function buildReleaseGate(metrics, majorGroupMinDecisions) {
  const majorLowSupportGroups = metrics.groups.filter(
    (group) => group.major && group.supportCoverage < 0.75,
  );
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
    probabilityFloorMaximumLogLossDelta:
      metrics.probabilityFloorSensitivity.maximumLogLossDelta,
    maximumProbabilityFloorLogLossDelta: 0.02,
    reasons,
  };
}

function assertRawPrediction(prediction) {
  const total = prediction.candidates.reduce(
    (sum, candidate) => sum + candidate.probability,
    0,
  );
  if (
    prediction.candidates.length < 2 ||
    prediction.candidates.some(
      (candidate) => !Number.isFinite(candidate.probability) || candidate.probability <= 0,
    ) ||
    Math.abs(total - 1) > 1e-9 ||
    prediction.observedActionProbability <= 0
  ) {
    throw new Error('Behavioral V5.2 full prediction violates raw-softmax contract.');
  }
}

function validateRequest(value) {
  if (
    value?.schemaVersion !== 1 ||
    value?.operation !== 'RECOMMENDATION_BEHAVIORAL_V5_2_FULL_TRAINING' ||
    value?.fullTrainingAuthorized !== true ||
    value?.valueV8TrainingAuthorized !== false ||
    value?.productionRankingChanged !== false ||
    value?.passiveShadowAuthorized !== false ||
    value?.randomizedCanaryAuthorized !== false ||
    !value?.selectedConfiguration
  ) {
    throw new Error('Invalid Behavioral V5.2 full-training request.');
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
    throw new Error('Dataset V6 is not eligible for full Behavioral V5.2.');
  }
}
function validateRefinement(value, configuration) {
  if (
    value?.operation !== 'RECOMMENDATION_BEHAVIORAL_V5_2_BOUNDED_REFINEMENT' ||
    value?.fullTrainingCandidatePrepared !== true ||
    value?.fullTrainingAuthorized !== false ||
    value?.valueV8TrainingAuthorized !== false ||
    value?.source?.datasetSha256 !== expectedDatasetSha256 ||
    value?.source?.futureTestRowCount !== 0
  ) {
    throw new Error('Refinement summary is not eligible for full Behavioral V5.2.');
  }
  const preferred = value.results?.find(
    (result) => result.variant === value.preferredVariant,
  );
  if (!preferred) throw new Error('Refinement preferred result is missing.');
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
    assertEqual(configuration[key], preferred.configuration?.[key], `selectedConfiguration.${key}`);
  }
}
function economyBand(netWorth) {
  if (!Number.isFinite(netWorth)) return 'UNKNOWN';
  if (netWorth < 5_000) return 'LT_5000';
  if (netWorth < 10_000) return '5000_9999';
  if (netWorth < 20_000) return '10000_19999';
  return 'GE_20000';
}
async function artifactDescriptor(path, rowCount) {
  return {
    fileName: path.split('/').pop(),
    sha256: await hashFile(path),
    byteLength: (await stat(path)).size,
    ...(rowCount === undefined ? {} : { rowCount }),
  };
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
