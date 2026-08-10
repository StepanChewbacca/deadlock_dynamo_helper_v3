import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const require = createRequire(import.meta.url);
const {
  buildRecommendationValueV8DiagnosticGate,
  createRecommendationValueV8ActionModel,
  createRecommendationValueV8DiagnosticMetricsAccumulator,
  createRecommendationValueV8StateModel,
  DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS,
  finalizeRecommendationValueV8DiagnosticMetrics,
  observeRecommendationValueV8DiagnosticDecision,
  permuteRecommendationValueV8CandidateMetadata,
  permuteRecommendationValueV8CandidatePayloads,
  predictRecommendationValueV8CandidateSet,
  predictRecommendationValueV8State,
  recommendationValueV8FoldId,
  recommendationValueV8Targets,
  RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION,
  RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
  RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
  RECOMMENDATION_VALUE_V8_HORIZONS,
  RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
  trainRecommendationValueV8ActionDecision,
  trainRecommendationValueV8StateDecision,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-value-v8-diagnostic.js');
const {
  openMaybeGzipNdjsonReadStream,
} = require('/app/apps/api/dist/src/deadlock-live/gzip-ndjson.js');

const V52_SCHEMA_VERSION = 1;
const V52_MODEL_VERSION = 'RECOMMENDATION_BEHAVIORAL_V5_2_LOW_RANK_TWO_TOWER_1_RAW_PROPENSITY';
const V52_FEATURE_VERSION = 'RECOMMENDATION_BEHAVIORAL_V5_2_FEATURES_1_TWO_TOWER';
const VALUE_DIAGNOSTIC_VERSION = 'RECOMMENDATION_VALUE_V8_DIAGNOSTIC_1';

const requestPath = requiredString('VALUE_V8_V5_2_BOUNDED_REQUEST_PATH');
const datasetDirectory = requiredString('DEADLOCK_RECOMMENDATION_VALUE_V8_DATASET_DIR');
const behavioralDirectory = requiredString('DEADLOCK_RECOMMENDATION_VALUE_V8_BEHAVIORAL_DIR');
const outputDirectory = requiredString('DEADLOCK_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_DIR');
const evidencePath = requiredString('VALUE_V8_BOUNDED_EVIDENCE_PATH');
const expectedDatasetSha256 = requiredSha256('EXPECTED_DATASET_SHA256');
const expectedBehavioralPropensitySha256 = requiredSha256('EXPECTED_BEHAVIORAL_PROPENSITY_SHA256');
const expectedBehavioralManifestSha256 = requiredSha256('EXPECTED_BEHAVIORAL_MANIFEST_SHA256');

const request = JSON.parse(await readFile(requestPath, 'utf8'));
validateRequest(request);
const options = fixedOptions();

const datasetManifest = JSON.parse(await readFile(join(datasetDirectory, 'manifest.json'), 'utf8'));
const datasetAudit = JSON.parse(await readFile(join(datasetDirectory, 'audit.json'), 'utf8'));
validateDataset(datasetManifest, datasetAudit);
const datasetPath = join(datasetDirectory, datasetManifest.artifact.fileName);
assertEqual(await hashFile(datasetPath), expectedDatasetSha256, 'Dataset V6 SHA-256');
assertEqual(datasetManifest.artifact.sha256, expectedDatasetSha256, 'Dataset manifest SHA-256');

const behavioralManifestPath = join(behavioralDirectory, 'manifest.json');
const behavioralManifestRaw = await readFile(behavioralManifestPath);
assertEqual(sha256(behavioralManifestRaw), expectedBehavioralManifestSha256, 'Behavioral manifest SHA-256');
const behavioralManifest = JSON.parse(behavioralManifestRaw.toString('utf8'));
const behavioralAudit = JSON.parse(await readFile(join(behavioralDirectory, 'audit.json'), 'utf8'));
const behavioralEvaluation = JSON.parse(await readFile(join(behavioralDirectory, 'evaluation.json'), 'utf8'));
validateBehavioral(behavioralManifest, behavioralAudit, behavioralEvaluation);
const propensityDescriptor = behavioralManifest.artifacts?.propensities;
const propensityPath = join(behavioralDirectory, propensityDescriptor.fileName);
assertEqual(await hashFile(propensityPath), expectedBehavioralPropensitySha256, 'Behavioral propensity SHA-256');
assertEqual(propensityDescriptor.sha256, expectedBehavioralPropensitySha256, 'Behavioral propensity manifest SHA-256');

const rows = await loadDiagnosticRows(datasetPath, options.maxRows, options.foldCount);
if (rows.invalidRowCount > 0) throw new Error('Dataset V6 contains invalid diagnostic rows.');
if (rows.train.length === 0 || rows.tuning.length === 0) throw new Error('Value V8 bounded diagnostic requires TRAIN and TUNING rows.');
if (rows.trainMatchIdsByFold.some((matches) => matches.size === 0)) throw new Error('Every Value V8 state fold needs a TRAIN match.');
const selectedDecisionIds = new Set([...rows.train, ...rows.tuning].map((row) => row.decisionId));
const propensities = await loadPropensities(propensityPath, selectedDecisionIds);
validatePropensityJoins(rows, propensities.byDecisionId, options.foldCount);

await mkdir(outputDirectory, { recursive: true });
const paths = {
  model: join(outputDirectory, 'model.json'),
  stateOof: join(outputDirectory, 'state-oof.ndjson'),
  predictions: join(outputDirectory, 'diagnostic-predictions.ndjson'),
  evaluation: join(outputDirectory, 'evaluation.json'),
  audit: join(outputDirectory, 'audit.json'),
  manifest: join(outputDirectory, 'manifest.json'),
};
for (const path of Object.values(paths)) await rm(path, { force: true });

const foldStateModels = Array.from({ length: options.foldCount }, () =>
  createRecommendationValueV8StateModel(options.hashDimension),
);
for (let epoch = 0; epoch < options.stateEpochs; epoch += 1) {
  for (const row of rows.train) {
    const holdoutFoldId = recommendationValueV8FoldId(row.matchId, options.foldCount);
    for (let foldId = 0; foldId < foldStateModels.length; foldId += 1) {
      if (foldId !== holdoutFoldId) {
        trainRecommendationValueV8StateDecision(foldStateModels[foldId], row, stateOptions(options));
      }
    }
  }
  await tick();
}

const finalStateModel = createRecommendationValueV8StateModel(options.hashDimension);
for (let epoch = 0; epoch < options.stateEpochs; epoch += 1) {
  for (const row of rows.train) {
    trainRecommendationValueV8StateDecision(finalStateModel, row, stateOptions(options));
  }
  await tick();
}

const actionModel = createRecommendationValueV8ActionModel(options.hashDimension);
for (let epoch = 0; epoch < options.actionEpochs; epoch += 1) {
  for (const row of rows.train) {
    const foldId = recommendationValueV8FoldId(row.matchId, options.foldCount);
    const statePredictions = predictRecommendationValueV8State(
      foldStateModels[foldId],
      row,
      options.maximumAbsolutePrediction,
    );
    const propensity = propensities.byDecisionId.get(row.decisionId);
    if (!propensity) throw new Error(`Missing Behavioral V5.2 propensity ${row.decisionId}.`);
    trainRecommendationValueV8ActionDecision(
      actionModel,
      row,
      statePredictions,
      propensity.observedActionProbability,
      actionOptions(options),
    );
  }
  await tick();
}

const oofWriter = await LineWriter.create(`${paths.stateOof}.partial`);
try {
  for (const row of rows.train) {
    const foldId = recommendationValueV8FoldId(row.matchId, options.foldCount);
    const statePredictions = predictRecommendationValueV8State(
      foldStateModels[foldId],
      row,
      options.maximumAbsolutePrediction,
    );
    const propensity = propensities.byDecisionId.get(row.decisionId);
    const targets = recommendationValueV8Targets(row);
    await oofWriter.write({
      schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
      stateModelVersion: RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
      decisionId: row.decisionId,
      matchId: row.matchId,
      foldId,
      trainingMatchExcluded: true,
      targets,
      statePredictions,
      residualTargets: subtractHorizons(targets, statePredictions),
      observedActionProbability: propensity.observedActionProbability,
      behavioralPredictionSource: 'CROSS_FITTED_OOF',
    });
  }
  await oofWriter.close();
  await rename(`${paths.stateOof}.partial`, paths.stateOof);
} catch (error) {
  await oofWriter.abort();
  throw error;
}

const accumulator = createRecommendationValueV8DiagnosticMetricsAccumulator();
const predictionWriter = await LineWriter.create(`${paths.predictions}.partial`);
try {
  for (const row of rows.tuning) {
    const statePredictions = predictRecommendationValueV8State(
      finalStateModel,
      row,
      options.maximumAbsolutePrediction,
    );
    const candidatePrediction = predictRecommendationValueV8CandidateSet(
      actionModel,
      row,
      row.candidates,
      options.maximumAbsoluteResidual,
    );
    const candidatePermutationPrediction = predictRecommendationValueV8CandidateSet(
      actionModel,
      row,
      permuteRecommendationValueV8CandidatePayloads(row.candidates),
      options.maximumAbsoluteResidual,
    );
    const metadataPermutationPrediction = predictRecommendationValueV8CandidateSet(
      actionModel,
      row,
      permuteRecommendationValueV8CandidateMetadata(row.candidates),
      options.maximumAbsoluteResidual,
    );
    observeRecommendationValueV8DiagnosticDecision({
      accumulator,
      row,
      statePredictions,
      candidatePrediction,
      candidatePermutationPrediction,
      metadataPermutationPrediction,
      sensitivityThreshold: options.thresholds.minimumAverageCandidateSeparation,
    });
    await predictionWriter.write({
      schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
      decisionId: row.decisionId,
      matchId: row.matchId,
      split: row.split,
      targets: recommendationValueV8Targets(row),
      statePredictions,
      observedActionKey: row.observedActionKey,
      candidatePrediction,
      candidatePermutationPrediction,
      metadataPermutationPrediction,
      futureTestUsed: false,
    });
  }
  await predictionWriter.close();
  await rename(`${paths.predictions}.partial`, paths.predictions);
} catch (error) {
  await predictionWriter.abort();
  throw error;
}

const metrics = finalizeRecommendationValueV8DiagnosticMetrics(accumulator);
const diagnosticGate = buildRecommendationValueV8DiagnosticGate(metrics, options.thresholds);
const generatedAt = new Date().toISOString();
const modelArtifact = {
  schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
  generatedAt,
  featureVersion: RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
  sourceDatasetSha256: expectedDatasetSha256,
  behavioralPropensitySha256: expectedBehavioralPropensitySha256,
  behavioralModelVersion: V52_MODEL_VERSION,
  behavioralFeatureVersion: V52_FEATURE_VERSION,
  diagnosticOnly: true,
  trainingContract: {
    stateInput: 'STATE_ONLY',
    stateTargets: [...RECOMMENDATION_VALUE_V8_HORIZONS],
    stateCrossFittingUnit: 'MATCH',
    actionInput: 'STATE_PLUS_OBSERVED_CANDIDATE',
    actionTarget: 'SHORT_HORIZON_OUTCOME_MINUS_OOF_STATE_PREDICTION',
    actionObservedCandidateOnly: true,
    candidateCentering: 'SUBTRACT_DECISION_CANDIDATE_MEAN',
    behavioralWeighting: 'STABILIZED_INVERSE_PROPENSITY',
    tuningUsedForTraining: false,
    futureTestUsedForTraining: false,
    futureTestUsedForSelection: false,
  },
  options,
  foldStateModels,
  finalStateModel,
  actionModel,
};
await atomicJson(paths.model, modelArtifact);

const evaluation = {
  schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
  generatedAt,
  diagnosticSplit: 'TUNING',
  metrics,
  importanceWeights: {
    mean: divide(actionModel.totalImportanceWeight, actionModel.trainedDecisionCount),
    maximum: options.maximumImportanceWeight,
    clippedDecisionCount: actionModel.clippedImportanceWeightCount,
    clippedRate: divide(actionModel.clippedImportanceWeightCount, actionModel.trainedDecisionCount),
  },
  diagnosticGate,
  futureTest: {
    usedForTraining: false,
    usedForSelection: false,
    evaluated: false,
  },
};
await atomicJson(paths.evaluation, evaluation);

const structuralPassed =
  propensities.invalidRowCount === 0 &&
  propensities.byDecisionId.size === selectedDecisionIds.size;
const audit = {
  schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
  generatedAt,
  passed: structuralPassed,
  diagnosticArtifactEligible: structuralPassed,
  fullTrainingRecommended: structuralPassed && diagnosticGate.fullTrainingRecommended,
  source: {
    datasetVersion: datasetManifest.datasetVersion,
    datasetAuditPassed: datasetAudit.passed,
    datasetTrainingArtifactEligible: datasetAudit.trainingArtifactEligible,
    datasetSha256: expectedDatasetSha256,
    behavioralModelVersion: V52_MODEL_VERSION,
    behavioralFeatureVersion: V52_FEATURE_VERSION,
    behavioralAuditPassed: behavioralAudit.passed,
    behavioralTrainingArtifactEligible: behavioralAudit.trainingArtifactEligible,
    behavioralPropensitySha256: expectedBehavioralPropensitySha256,
    scannedDatasetRowCount: rows.scannedRowCount,
    trainDecisionCount: rows.train.length,
    tuningDecisionCount: rows.tuning.length,
    futureTestDecisionCount: rows.futureTestDecisionCount,
    invalidDatasetRowCount: rows.invalidRowCount,
    excludedRowCount: rows.excludedRowCount,
    propensityJoinCount: propensities.byDecisionId.size,
  },
  crossFitting: {
    unit: 'MATCH',
    foldCount: options.foldCount,
    foldMatchCounts: rows.trainMatchIdsByFold.map((matches) => matches.size),
    trainingMatchExclusionVerified: true,
    stateOofRowCount: rows.train.length,
  },
  leakage: {
    stateModelCandidateFeaturesUsed: false,
    actionModelObservedCandidateOnly: true,
    tuningUsedForTraining: false,
    futureTestUsedForTraining: false,
    futureTestUsedForSelection: false,
    finalOutcomeUsedForTraining: false,
  },
  build: {
    diagnosticOnly: true,
    maxRows: options.maxRows,
    fullCorpus: false,
  },
  diagnosticGate,
  reasons: structuralPassed ? [] : ['Value V8 V5.2 bounded structural audit failed.'],
};
await atomicJson(paths.audit, audit);

const manifest = {
  schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
  generatedAt,
  diagnosticVersion: VALUE_DIAGNOSTIC_VERSION,
  stateModelVersion: RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
  actionModelVersion: RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION,
  featureVersion: RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
  source: {
    dataset: {
      directory: datasetDirectory,
      fileName: datasetManifest.artifact.fileName,
      version: datasetManifest.datasetVersion,
      sha256: expectedDatasetSha256,
      byteLength: (await stat(datasetPath)).size,
      splitDescriptor: datasetManifest.splitDescriptor,
    },
    behavioral: {
      directory: behavioralDirectory,
      fileName: propensityDescriptor.fileName,
      schemaVersion: V52_SCHEMA_VERSION,
      modelVersion: V52_MODEL_VERSION,
      featureVersion: V52_FEATURE_VERSION,
      sha256: expectedBehavioralPropensitySha256,
      byteLength: (await stat(propensityPath)).size,
    },
  },
  artifacts: {
    model: await artifactDescriptor(paths.model),
    stateOof: await artifactDescriptor(paths.stateOof, rows.train.length),
    predictions: await artifactDescriptor(paths.predictions, rows.tuning.length),
    evaluation: await artifactDescriptor(paths.evaluation),
    audit: await artifactDescriptor(paths.audit),
  },
  diagnosticOnly: true,
  futureTestUsed: false,
  auditPassed: structuralPassed,
  diagnosticGatePassed: diagnosticGate.passed,
  fullTrainingRecommended: structuralPassed && diagnosticGate.fullTrainingRecommended,
};
await atomicJson(paths.manifest, manifest);

const gateChecks = {
  auditPassed: audit.passed === true,
  diagnosticArtifactEligible: audit.diagnosticArtifactEligible === true,
  diagnosticGatePassed: manifest.diagnosticGatePassed === true,
  fullTrainingRecommended: manifest.fullTrainingRecommended === true,
  diagnosticOnly: manifest.diagnosticOnly === true,
  maxRows: audit.build.maxRows === 50_000,
  notFullCorpus: audit.build.fullCorpus === false,
  futureNotTraining: audit.leakage.futureTestUsedForTraining === false,
  futureNotSelection: audit.leakage.futureTestUsedForSelection === false,
  futureNotEvaluated: evaluation.futureTest.evaluated === false,
  tuningNotTraining: audit.leakage.tuningUsedForTraining === false,
  v52RawPropensityContract: true,
  sourceDatasetShaMatches: manifest.source.dataset.sha256 === expectedDatasetSha256,
  behavioralPropensityShaMatches:
    manifest.source.behavioral.sha256 === expectedBehavioralPropensitySha256,
};
const evidence = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_VALUE_V8_BOUNDED_V5_2',
  generatedAt,
  datasetDirectory,
  behavioralDirectory,
  outputDirectory,
  options,
  gateChecks,
  audit,
  evaluation,
  manifest,
  valueV8DiagnosticAuthorized: true,
  fullValueV8TrainingAuthorized: false,
  offlineVerificationAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};
await writeFile(evidencePath, `${JSON.stringify(evidence, undefined, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
const failedGates = Object.entries(gateChecks).filter(([, passed]) => passed !== true).map(([name]) => name);
if (failedGates.length > 0) throw new Error(`Value V8 V5.2 bounded gates failed: ${failedGates.join(', ')}.`);

function fixedOptions() {
  return {
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
    thresholds: {
      minimumTuningDecisionCount:
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumTuningDecisionCount,
      minimumStateRmseImprovement:
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumStateRmseImprovement,
      minimumCandidateSensitiveDecisionRate:
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumCandidateSensitiveDecisionRate,
      minimumAverageCandidateSeparation:
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumAverageCandidateSeparation,
      minimumCandidatePermutationRmseIncrease:
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumCandidatePermutationRmseIncrease,
      minimumMetadataPermutationRmseIncrease:
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumMetadataPermutationRmseIncrease,
      maximumAbsoluteCenteredMean:
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.maximumAbsoluteCenteredMean,
    },
  };
}
function validateRequest(value) {
  if (
    value?.schemaVersion !== 1 ||
    value?.operation !== 'RECOMMENDATION_VALUE_V8_BOUNDED_V5_2' ||
    value?.valueV8DiagnosticAuthorized !== true ||
    value?.maximumTrainingMinutes !== 20 ||
    value?.maxRows !== 50_000 ||
    value?.fullValueV8TrainingAuthorized !== false ||
    value?.offlineVerificationAuthorized !== false ||
    value?.productionRankingChanged !== false ||
    value?.passiveShadowAuthorized !== false ||
    value?.randomizedCanaryAuthorized !== false
  ) {
    throw new Error('Invalid Value V8 V5.2 bounded request.');
  }
}
function validateDataset(manifest, audit) {
  if (
    manifest.auditPassed !== true ||
    manifest.trainingArtifactEligible !== true ||
    audit.passed !== true ||
    audit.trainingArtifactEligible !== true ||
    manifest.featureContract?.futureTestEligibleForSelection !== false ||
    manifest.featureContract?.userLiveUsedAsInput !== false
  ) throw new Error('Dataset V6 is not eligible for Value V8.');
}
function validateBehavioral(manifest, audit, evaluation) {
  if (
    manifest.schemaVersion !== V52_SCHEMA_VERSION ||
    manifest.modelVersion !== V52_MODEL_VERSION ||
    manifest.featureVersion !== V52_FEATURE_VERSION ||
    manifest.auditPassed !== true ||
    manifest.releaseGatePassed !== true ||
    manifest.trainingArtifactEligible !== true ||
    (manifest.build?.fullCorpus !== true && audit.build?.fullCorpus !== true) ||
    audit.passed !== true ||
    audit.trainingArtifactEligible !== true ||
    evaluation.releaseGate?.passed !== true ||
    manifest.trainingContract?.propensityOutput !== 'RAW_SOFTMAX_WITHIN_DECISION' ||
    manifest.trainingContract?.candidateProbabilityFloorApplied !== false ||
    manifest.trainingContract?.ipsClippingApplied !== false ||
    manifest.trainingContract?.probabilityFloorSensitivity !== 'OBSERVED_PROPENSITY_CLIP_ONLY' ||
    manifest.trainingContract?.futureTestUsedForTraining !== false ||
    manifest.trainingContract?.futureTestUsedForSelection !== false ||
    (manifest.source?.sha256 ?? manifest.sourceDatasetSha256) !== expectedDatasetSha256
  ) throw new Error('Behavioral V5.2 is not eligible for bounded Value V8.');
}

async function loadDiagnosticRows(path, maxRows, foldCount) {
  const trainLimit = Math.max(foldCount * 2, Math.floor(maxRows * 0.8));
  const tuningLimit = Math.max(1, maxRows - trainLimit);
  const result = {
    train: [], tuning: [], futureTestDecisionCount: 0,
    scannedRowCount: 0, invalidRowCount: 0, excludedRowCount: 0,
    trainMatchIdsByFold: Array.from({ length: foldCount }, () => new Set()),
  };
  const input = createInterface({ input: await openMaybeGzipNdjsonReadStream(path), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    result.scannedRowCount += 1;
    let row;
    try { row = JSON.parse(line); } catch { result.invalidRowCount += 1; continue; }
    if (row.split === 'FUTURE_TEST') { result.futureTestDecisionCount += 1; continue; }
    if (!isValueEligible(row)) { result.excludedRowCount += 1; continue; }
    if (row.split === 'TRAIN' && result.train.length < trainLimit) {
      result.train.push(row);
      result.trainMatchIdsByFold[recommendationValueV8FoldId(row.matchId, foldCount)].add(row.matchId);
    } else if (row.split === 'TUNING' && result.tuning.length < tuningLimit) {
      result.tuning.push(row);
    }
  }
  return result;
}
function isValueEligible(row) {
  return (
    row?.eligibility?.stateModel === true &&
    row?.eligibility?.actionModel === true &&
    row?.observedActionInCandidateSet === true &&
    Array.isArray(row?.candidates) && row.candidates.length >= 2 &&
    row.candidates.every((candidate) => candidate.catalogMetadataAvailable === true) &&
    Object.keys(recommendationValueV8Targets(row)).length > 0
  );
}

async function loadPropensities(path, selectedDecisionIds) {
  const result = { byDecisionId: new Map(), scannedRowCount: 0, invalidRowCount: 0 };
  for await (const line of linesFromMaybeGzip(path)) {
    if (!line.trim()) continue;
    result.scannedRowCount += 1;
    let row;
    try { row = JSON.parse(line); } catch { result.invalidRowCount += 1; continue; }
    if (!selectedDecisionIds.has(row.decisionId)) continue;
    if (!isValidV52Propensity(row)) { result.invalidRowCount += 1; continue; }
    if (result.byDecisionId.has(row.decisionId)) throw new Error(`Duplicate Behavioral V5.2 propensity ${row.decisionId}.`);
    result.byDecisionId.set(row.decisionId, row);
  }
  return result;
}
function isValidV52Propensity(row) {
  const total = Array.isArray(row?.candidates)
    ? row.candidates.reduce((sum, candidate) => sum + Number(candidate.probability), 0)
    : Number.NaN;
  return (
    row?.schemaVersion === V52_SCHEMA_VERSION &&
    row?.modelVersion === V52_MODEL_VERSION &&
    row?.featureVersion === V52_FEATURE_VERSION &&
    row?.probabilityContract === 'RAW_SOFTMAX_WITHIN_DECISION' &&
    row?.propensityFloorApplied === false &&
    row?.observedActionProbability === row?.observedActionRawProbability &&
    Number.isFinite(row?.observedActionProbability) && row.observedActionProbability > 0 &&
    Array.isArray(row?.candidates) && row.candidates.length >= 2 &&
    row.candidates.every((candidate) =>
      Number.isFinite(candidate.probability) && candidate.probability > 0 &&
      candidate.probability === candidate.rawProbability
    ) && Number.isFinite(total) && Math.abs(total - 1) <= 1e-9
  );
}
function validatePropensityJoins(rows, byDecisionId, foldCount) {
  for (const row of [...rows.train, ...rows.tuning]) {
    const propensity = byDecisionId.get(row.decisionId);
    if (!propensity) throw new Error(`Missing Behavioral V5.2 propensity ${row.decisionId}.`);
    if (
      propensity.matchId !== row.matchId ||
      propensity.split !== row.split ||
      propensity.sourceDatasetSha256 !== expectedDatasetSha256 ||
      propensity.trainingMatchExcluded !== true ||
      propensity.observedActionKey !== row.observedActionKey
    ) throw new Error(`Invalid Behavioral V5.2 propensity join ${row.decisionId}.`);
    if (row.split === 'TRAIN') {
      const foldId = recommendationValueV8FoldId(row.matchId, foldCount);
      if (propensity.predictionSource !== 'CROSS_FITTED_OOF' || propensity.foldId !== foldId) {
        throw new Error(`Behavioral V5.2 TRAIN propensity is not matching OOF ${row.decisionId}.`);
      }
    } else if (propensity.predictionSource !== 'FULL_TRAIN_MODEL') {
      throw new Error(`Behavioral V5.2 TUNING propensity is not full-TRAIN ${row.decisionId}.`);
    }
  }
}

function stateOptions(options) {
  return { learningRate: options.stateLearningRate, l2: options.stateL2, maximumAbsolutePrediction: options.maximumAbsolutePrediction };
}
function actionOptions(options) {
  return {
    learningRate: options.actionLearningRate,
    l2: options.actionL2,
    maximumAbsoluteResidual: options.maximumAbsoluteResidual,
    propensityFloor: options.propensityFloor,
    maximumImportanceWeight: options.maximumImportanceWeight,
  };
}
function subtractHorizons(targets, predictions) {
  return Object.fromEntries(
    RECOMMENDATION_VALUE_V8_HORIZONS.flatMap((horizon) => {
      const target = targets[horizon];
      const prediction = predictions[horizon];
      return target === undefined || prediction === undefined ? [] : [[horizon, target - prediction]];
    }),
  );
}

class LineWriter {
  static async create(path) { return new LineWriter(path, await open(path, 'wx')); }
  constructor(path, handle) { this.path = path; this.handle = handle; }
  async write(value) { await this.handle.write(`${JSON.stringify(value)}\n`); }
  async close() { await this.handle.sync(); await this.handle.close(); }
  async abort() { try { await this.handle.close(); } catch {} await rm(this.path, { force: true }); }
}

async function* linesFromMaybeGzip(path) {
  const raw = createReadStream(path);
  const input = path.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) yield line;
}
async function artifactDescriptor(path, rowCount) {
  return {
    fileName: path.split('/').pop(),
    sha256: await hashFile(path),
    byteLength: (await stat(path)).size,
    ...(rowCount === undefined ? {} : { rowCount }),
  };
}
async function atomicJson(path, value) { await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8'); }
async function hashFile(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function requiredString(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing required environment variable ${name}.`); return value; }
function requiredSha256(name) { const value = requiredString(name); if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a lowercase SHA-256 value.`); return value; }
function assertEqual(actual, expected, label) { if (actual !== expected) throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`); }
function divide(numerator, denominator) { return denominator === 0 ? 0 : numerator / denominator; }
function tick() { return new Promise((resolve) => setImmediate(resolve)); }
