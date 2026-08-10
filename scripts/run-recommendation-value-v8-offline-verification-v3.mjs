import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createGunzip } from 'node:zlib';

const require = createRequire(import.meta.url);
const {
  predictRecommendationValueV8CandidateSet,
  predictRecommendationValueV8State,
  validateRecommendationValueV8ActionModel,
  validateRecommendationValueV8StateModel,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-value-v8-diagnostic.js');

const datasetDirectory = requiredString('OFFLINE_VALUE_V8_DATASET_DIR');
const valueDirectory = requiredString('OFFLINE_VALUE_V8_DIAGNOSTIC_DIR');
const evidencePath = requiredString('OFFLINE_VALUE_V8_EVIDENCE_PATH');
const expectedDatasetSha256 = requiredSha256('EXPECTED_DATASET_SHA256');
const expectedBehavioralPropensitySha256 = requiredSha256(
  'EXPECTED_BEHAVIORAL_PROPENSITY_SHA256',
);
const expectedValueManifestSha256 = requiredSha256('EXPECTED_VALUE_MANIFEST_SHA256');
const expectedValueModelSha256 = requiredSha256('EXPECTED_VALUE_MODEL_SHA256');
const expectedValuePredictionsSha256 = requiredSha256(
  'EXPECTED_VALUE_PREDICTIONS_SHA256',
);
const expectedValueEvaluationSha256 = requiredSha256(
  'EXPECTED_VALUE_EVALUATION_SHA256',
);
const expectedValueAuditSha256 = requiredSha256('EXPECTED_VALUE_AUDIT_SHA256');
const replayLimit = boundedIntegerFromEnv('OFFLINE_REPLAY_LIMIT', 1_000, 100, 5_000);

const valuePaths = {
  manifest: join(valueDirectory, 'manifest.json'),
  model: join(valueDirectory, 'model.json'),
  predictions: join(valueDirectory, 'diagnostic-predictions.ndjson'),
  evaluation: join(valueDirectory, 'evaluation.json'),
  audit: join(valueDirectory, 'audit.json'),
};

const [manifestRaw, modelRaw, evaluationRaw, auditRaw] = await Promise.all([
  readFile(valuePaths.manifest),
  readFile(valuePaths.model),
  readFile(valuePaths.evaluation),
  readFile(valuePaths.audit),
]);
assertEqual(sha256(manifestRaw), expectedValueManifestSha256, 'Value manifest SHA-256');
assertEqual(sha256(modelRaw), expectedValueModelSha256, 'Value model SHA-256');
assertEqual(sha256(evaluationRaw), expectedValueEvaluationSha256, 'Value evaluation SHA-256');
assertEqual(sha256(auditRaw), expectedValueAuditSha256, 'Value audit SHA-256');
assertEqual(
  await hashFile(valuePaths.predictions),
  expectedValuePredictionsSha256,
  'Value predictions SHA-256',
);

const manifest = JSON.parse(manifestRaw.toString('utf8'));
const model = JSON.parse(modelRaw.toString('utf8'));
const evaluation = JSON.parse(evaluationRaw.toString('utf8'));
const audit = JSON.parse(auditRaw.toString('utf8'));
validateBoundedValueEvidence(manifest, evaluation, audit);

const modelDescriptor = manifest.artifacts?.model;
const predictionDescriptor = manifest.artifacts?.predictions;
const evaluationDescriptor = manifest.artifacts?.evaluation;
const auditDescriptor = manifest.artifacts?.audit;
assertEqual(modelDescriptor?.sha256, expectedValueModelSha256, 'manifest model SHA-256');
assertEqual(
  predictionDescriptor?.sha256,
  expectedValuePredictionsSha256,
  'manifest predictions SHA-256',
);
assertEqual(
  evaluationDescriptor?.sha256,
  expectedValueEvaluationSha256,
  'manifest evaluation SHA-256',
);
assertEqual(auditDescriptor?.sha256, expectedValueAuditSha256, 'manifest audit SHA-256');

validateRecommendationValueV8StateModel(model.finalStateModel);
validateRecommendationValueV8ActionModel(model.actionModel);

const predictions = await loadPredictions(valuePaths.predictions);
if (predictions.rows.length === 0) {
  throw new Error('Value V8 diagnostic prediction artifact is empty.');
}
const predictionDiagnostics = summarizePredictions(predictions.rows);
const replayPredictionRows = predictions.rows.slice(0, Math.min(replayLimit, predictions.rows.length));
const selectedDecisionIds = new Set(replayPredictionRows.map((row) => row.decisionId));

const datasetManifest = JSON.parse(
  await readFile(join(datasetDirectory, 'manifest.json'), 'utf8'),
);
assertEqual(datasetManifest.artifact?.sha256, expectedDatasetSha256, 'Dataset manifest SHA-256');
const datasetPath = join(datasetDirectory, datasetManifest.artifact.fileName);
assertEqual(await hashFile(datasetPath), expectedDatasetSha256, 'Dataset artifact SHA-256');
const replayRows = await loadSelectedDatasetRows(datasetPath, selectedDecisionIds);

const deterministic = runDeterministicReplay(
  replayPredictionRows,
  replayRows,
  model.finalStateModel,
  model.actionModel,
  model.options?.maximumAbsolutePrediction ?? 1,
  model.options?.maximumAbsoluteResidual ?? 1,
);
const runtime = runRuntimeProbe(
  replayPredictionRows,
  replayRows,
  model.finalStateModel,
  model.actionModel,
  model.options?.maximumAbsolutePrediction ?? 1,
  model.options?.maximumAbsoluteResidual ?? 1,
);

const metrics = evaluation.metrics ?? {};
const stateOnlyComparison = {
  baseline: 'STATE_ONLY',
  challenger: 'STATE_PLUS_ACTION_RESIDUAL',
  stateRmse: metrics.stateRmse,
  challengerRmse: metrics.actionRmse,
  rmseImprovement: metrics.stateRmseImprovement,
  candidatePermutationRmseIncrease: metrics.candidatePermutationRmseIncrease,
  metadataPermutationRmseIncrease: metrics.metadataPermutationRmseIncrease,
  stateOnlyCandidateRanking: 'ALL_CANDIDATES_TIED_BY_DEFINITION',
  challengerNonTrivialRankingRate:
    predictionDiagnostics.nonTrivialRankingRate,
};

const gateChecks = {
  boundedAuditPassed: audit.passed === true,
  boundedDiagnosticArtifactEligible: audit.diagnosticArtifactEligible === true,
  boundedDiagnosticGatePassed: manifest.diagnosticGatePassed === true,
  boundedFullTrainingRecommended: manifest.fullTrainingRecommended === true,
  boundedDiagnosticOnly: manifest.diagnosticOnly === true,
  boundedMaxRows: audit.build?.maxRows === 50_000,
  futureNotTraining:
    audit.leakage?.futureTestUsedForTraining === false &&
    evaluation.futureTest?.usedForTraining === false,
  futureNotSelection:
    audit.leakage?.futureTestUsedForSelection === false &&
    evaluation.futureTest?.usedForSelection === false,
  futureNotEvaluated: evaluation.futureTest?.evaluated === false,
  predictionArtifactHasNoFutureRows: predictionDiagnostics.futureTestRowCount === 0,
  predictionRowsValid: predictionDiagnostics.invalidRowCount === 0,
  deterministicReplayComplete:
    deterministic.replayedDecisionCount === replayPredictionRows.length,
  deterministicRepeatedInference:
    deterministic.repeatMismatchCount === 0,
  deterministicStoredPredictionMatch:
    deterministic.storedPredictionMismatchCount === 0,
  replayUsesTuningOnly: deterministic.nonTuningRowCount === 0,
  candidateRankingNonTrivial:
    predictionDiagnostics.nonTrivialRankingRate > 0,
  runtimeMeasurementsFinite:
    Number.isFinite(runtime.latencyMs.p50) &&
    Number.isFinite(runtime.latencyMs.p95) &&
    Number.isFinite(runtime.latencyMs.p99) &&
    Number.isFinite(runtime.heapUsedBytes.before) &&
    Number.isFinite(runtime.heapUsedBytes.after) &&
    Number.isFinite(runtime.heapUsedBytes.peak),
  sourceDatasetShaMatches:
    manifest.source?.dataset?.sha256 === expectedDatasetSha256 &&
    model.sourceDatasetSha256 === expectedDatasetSha256,
  behavioralPropensityShaMatches:
    manifest.source?.behavioral?.sha256 ===
      expectedBehavioralPropensitySha256 &&
    model.behavioralPropensitySha256 === expectedBehavioralPropensitySha256,
};

const failedGates = Object.entries(gateChecks)
  .filter(([, passed]) => passed !== true)
  .map(([name]) => name);
const evidence = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_VALUE_V8_OFFLINE_VERIFICATION_V3',
  generatedAt: new Date().toISOString(),
  datasetDirectory,
  valueDirectory,
  lineage: {
    datasetSha256: expectedDatasetSha256,
    behavioralPropensitySha256: expectedBehavioralPropensitySha256,
    valueManifestSha256: expectedValueManifestSha256,
    valueModelSha256: expectedValueModelSha256,
    valuePredictionsSha256: expectedValuePredictionsSha256,
    valueEvaluationSha256: expectedValueEvaluationSha256,
    valueAuditSha256: expectedValueAuditSha256,
  },
  boundedGate: evaluation.diagnosticGate,
  predictionDiagnostics,
  deterministicReplay: deterministic,
  stateOnlyComparison,
  runtime,
  gateChecks,
  offlineVerificationPassed: failedGates.length === 0,
  fullValueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};

await writeFile(evidencePath, `${JSON.stringify(evidence, undefined, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
if (failedGates.length > 0) {
  throw new Error(`Value V8 offline verification failed: ${failedGates.join(', ')}.`);
}

function validateBoundedValueEvidence(valueManifest, valueEvaluation, valueAudit) {
  assertEqual(valueManifest.diagnosticOnly, true, 'Value diagnosticOnly');
  assertEqual(valueManifest.futureTestUsed, false, 'Value manifest FUTURE_TEST use');
  assertEqual(valueManifest.auditPassed, true, 'Value manifest audit');
  assertEqual(valueManifest.diagnosticGatePassed, true, 'Value diagnostic gate');
  assertEqual(
    valueManifest.fullTrainingRecommended,
    true,
    'Value full-training recommendation',
  );
  assertEqual(valueAudit.passed, true, 'Value audit.passed');
  assertEqual(
    valueAudit.diagnosticArtifactEligible,
    true,
    'Value diagnostic artifact eligibility',
  );
  assertEqual(valueAudit.build?.diagnosticOnly, true, 'Value audit diagnosticOnly');
  assertEqual(valueAudit.build?.maxRows, 50_000, 'Value audit maxRows');
  assertEqual(valueAudit.build?.fullCorpus, false, 'Value audit fullCorpus');
  assertEqual(
    valueAudit.leakage?.futureTestUsedForTraining,
    false,
    'Value FUTURE_TEST training',
  );
  assertEqual(
    valueAudit.leakage?.futureTestUsedForSelection,
    false,
    'Value FUTURE_TEST selection',
  );
  assertEqual(valueEvaluation.diagnosticGate?.passed, true, 'Value evaluation gate');
  assertEqual(
    valueEvaluation.diagnosticGate?.fullTrainingRecommended,
    true,
    'Value evaluation full-training recommendation',
  );
  assertEqual(
    valueEvaluation.futureTest?.evaluated,
    false,
    'Value FUTURE_TEST evaluation',
  );
  assertEqual(
    valueManifest.source?.dataset?.sha256,
    expectedDatasetSha256,
    'Value source Dataset SHA-256',
  );
  assertEqual(
    valueManifest.source?.behavioral?.sha256,
    expectedBehavioralPropensitySha256,
    'Value source Behavioral propensity SHA-256',
  );
}

async function loadPredictions(path) {
  const rows = [];
  let invalidRowCount = 0;
  for await (const line of linesFromPath(path)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const row = JSON.parse(line);
      if (
        typeof row.decisionId !== 'string' ||
        typeof row.matchId !== 'string' ||
        row.split !== 'TUNING' ||
        !row.statePredictions ||
        !row.candidatePrediction ||
        !Array.isArray(row.candidatePrediction.candidates)
      ) {
        invalidRowCount += 1;
      }
      rows.push(row);
    } catch {
      invalidRowCount += 1;
    }
  }
  return { rows, invalidRowCount };
}

function summarizePredictions(rows) {
  let invalidRowCount = 0;
  let futureTestRowCount = 0;
  let nonTrivialRankingCount = 0;
  let observedActionTop1Count = 0;
  let separationSum = 0;
  let minimumSeparation = Infinity;
  let maximumSeparation = 0;
  let maximumAbsoluteCenteredMean = 0;
  for (const row of rows) {
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
    }
    const prediction = row.candidatePrediction;
    const separation = Number(prediction?.candidateSeparation);
    if (
      !Number.isFinite(separation) ||
      !Array.isArray(prediction?.candidates) ||
      prediction.candidates.length < 2
    ) {
      invalidRowCount += 1;
      continue;
    }
    separationSum += separation;
    minimumSeparation = Math.min(minimumSeparation, separation);
    maximumSeparation = Math.max(maximumSeparation, separation);
    maximumAbsoluteCenteredMean = Math.max(
      maximumAbsoluteCenteredMean,
      Number(prediction.maximumAbsoluteCenteredMean) || 0,
    );
    if (separation > 1e-12) {
      nonTrivialRankingCount += 1;
    }
    const top = prediction.candidates.find((candidate) => candidate.rank === 1);
    if (top?.actionKey === row.observedActionKey) {
      observedActionTop1Count += 1;
    }
  }
  return {
    decisionCount: rows.length,
    invalidRowCount,
    futureTestRowCount,
    averageCandidateSeparation: rows.length === 0 ? 0 : separationSum / rows.length,
    minimumCandidateSeparation:
      minimumSeparation === Infinity ? 0 : minimumSeparation,
    maximumCandidateSeparation: maximumSeparation,
    maximumAbsoluteCenteredMean,
    nonTrivialRankingRate:
      rows.length === 0 ? 0 : nonTrivialRankingCount / rows.length,
    observedActionTop1Rate:
      rows.length === 0 ? 0 : observedActionTop1Count / rows.length,
  };
}

async function loadSelectedDatasetRows(path, selectedDecisionIds) {
  const rows = new Map();
  for await (const line of linesFromPath(path)) {
    if (!line.trim()) {
      continue;
    }
    const row = JSON.parse(line);
    if (!selectedDecisionIds.has(row.decisionId)) {
      continue;
    }
    rows.set(row.decisionId, row);
    if (rows.size === selectedDecisionIds.size) {
      break;
    }
  }
  if (rows.size !== selectedDecisionIds.size) {
    throw new Error(
      `Offline replay dataset join incomplete: expected ${selectedDecisionIds.size}, found ${rows.size}.`,
    );
  }
  return rows;
}

function runDeterministicReplay(
  predictionRows,
  datasetRows,
  stateModel,
  actionModel,
  maximumAbsolutePrediction,
  maximumAbsoluteResidual,
) {
  let replayedDecisionCount = 0;
  let repeatMismatchCount = 0;
  let storedPredictionMismatchCount = 0;
  let nonTuningRowCount = 0;
  for (const stored of predictionRows) {
    const row = datasetRows.get(stored.decisionId);
    if (!row) {
      continue;
    }
    nonTuningRowCount += row.split === 'TUNING' ? 0 : 1;
    const firstState = predictRecommendationValueV8State(
      stateModel,
      row,
      maximumAbsolutePrediction,
    );
    const firstCandidates = predictRecommendationValueV8CandidateSet(
      actionModel,
      row,
      row.candidates,
      maximumAbsoluteResidual,
    );
    const secondState = predictRecommendationValueV8State(
      stateModel,
      row,
      maximumAbsolutePrediction,
    );
    const secondCandidates = predictRecommendationValueV8CandidateSet(
      actionModel,
      row,
      row.candidates,
      maximumAbsoluteResidual,
    );
    if (
      stableJson(firstState) !== stableJson(secondState) ||
      stableJson(firstCandidates) !== stableJson(secondCandidates)
    ) {
      repeatMismatchCount += 1;
    }
    if (
      stableJson(firstState) !== stableJson(stored.statePredictions) ||
      stableJson(firstCandidates) !== stableJson(stored.candidatePrediction)
    ) {
      storedPredictionMismatchCount += 1;
    }
    replayedDecisionCount += 1;
  }
  return {
    requestedDecisionCount: predictionRows.length,
    replayedDecisionCount,
    repeatMismatchCount,
    storedPredictionMismatchCount,
    nonTuningRowCount,
  };
}

function runRuntimeProbe(
  predictionRows,
  datasetRows,
  stateModel,
  actionModel,
  maximumAbsolutePrediction,
  maximumAbsoluteResidual,
) {
  const latencies = [];
  const before = process.memoryUsage().heapUsed;
  let peak = before;
  for (const stored of predictionRows) {
    const row = datasetRows.get(stored.decisionId);
    const started = performance.now();
    predictRecommendationValueV8State(
      stateModel,
      row,
      maximumAbsolutePrediction,
    );
    predictRecommendationValueV8CandidateSet(
      actionModel,
      row,
      row.candidates,
      maximumAbsoluteResidual,
    );
    latencies.push(performance.now() - started);
    peak = Math.max(peak, process.memoryUsage().heapUsed);
  }
  const after = process.memoryUsage().heapUsed;
  latencies.sort((left, right) => left - right);
  return {
    decisionCount: latencies.length,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      maximum: latencies.at(-1) ?? 0,
      mean:
        latencies.length === 0
          ? 0
          : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    },
    heapUsedBytes: { before, after, peak, delta: after - before },
  };
}

async function* linesFromPath(path) {
  const handle = await open(path, 'r');
  const header = Buffer.alloc(2);
  await handle.read(header, 0, 2, 0);
  await handle.close();
  const raw = createReadStream(path);
  const input = header[0] === 0x1f && header[1] === 0x8b ? raw.pipe(createGunzip()) : raw;
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    yield line;
  }
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

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
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

function boundedIntegerFromEnv(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer in ${minimum}..${maximum}.`);
  }
  return value;
}
