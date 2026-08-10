import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const require = createRequire(import.meta.url);
const {
  predictRecommendationValueV8CandidateSet,
  predictRecommendationValueV8State,
  validateRecommendationValueV8ActionModel,
  validateRecommendationValueV8StateModel,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-value-v8-diagnostic.js');

const requestPath = requiredString('OFFLINE_VALUE_V8_V5_2_REQUEST_PATH');
const datasetDirectory = requiredString('OFFLINE_VALUE_V8_DATASET_DIR');
const valueDirectory = requiredString('OFFLINE_VALUE_V8_DIAGNOSTIC_DIR');
const evidencePath = requiredString('OFFLINE_VALUE_V8_EVIDENCE_PATH');
const expectedDatasetSha256 = requiredSha256('EXPECTED_DATASET_SHA256');
const expectedBehavioralPropensitySha256 = requiredSha256('EXPECTED_BEHAVIORAL_PROPENSITY_SHA256');
const expectedValueManifestSha256 = requiredSha256('EXPECTED_VALUE_MANIFEST_SHA256');
const expectedValueModelSha256 = requiredSha256('EXPECTED_VALUE_MODEL_SHA256');
const expectedValuePredictionsSha256 = requiredSha256('EXPECTED_VALUE_PREDICTIONS_SHA256');
const expectedValueEvaluationSha256 = requiredSha256('EXPECTED_VALUE_EVALUATION_SHA256');
const expectedValueAuditSha256 = requiredSha256('EXPECTED_VALUE_AUDIT_SHA256');

const request = JSON.parse(await readFile(requestPath, 'utf8'));
validateRequest(request);
const paths = {
  manifest: join(valueDirectory, 'manifest.json'),
  model: join(valueDirectory, 'model.json'),
  predictions: join(valueDirectory, 'diagnostic-predictions.ndjson'),
  evaluation: join(valueDirectory, 'evaluation.json'),
  audit: join(valueDirectory, 'audit.json'),
};
const [manifestRaw, modelRaw, evaluationRaw, auditRaw] = await Promise.all([
  readFile(paths.manifest),
  readFile(paths.model),
  readFile(paths.evaluation),
  readFile(paths.audit),
]);
assertEqual(sha256(manifestRaw), expectedValueManifestSha256, 'Value manifest SHA-256');
assertEqual(sha256(modelRaw), expectedValueModelSha256, 'Value model SHA-256');
assertEqual(sha256(evaluationRaw), expectedValueEvaluationSha256, 'Value evaluation SHA-256');
assertEqual(sha256(auditRaw), expectedValueAuditSha256, 'Value audit SHA-256');
assertEqual(await hashFile(paths.predictions), expectedValuePredictionsSha256, 'Value predictions SHA-256');

const manifest = JSON.parse(manifestRaw.toString('utf8'));
const model = JSON.parse(modelRaw.toString('utf8'));
const evaluation = JSON.parse(evaluationRaw.toString('utf8'));
const audit = JSON.parse(auditRaw.toString('utf8'));
validateValueArtifacts(manifest, evaluation, audit);
assertEqual(manifest.artifacts?.model?.sha256, expectedValueModelSha256, 'manifest model SHA');
assertEqual(manifest.artifacts?.predictions?.sha256, expectedValuePredictionsSha256, 'manifest predictions SHA');
assertEqual(manifest.artifacts?.evaluation?.sha256, expectedValueEvaluationSha256, 'manifest evaluation SHA');
assertEqual(manifest.artifacts?.audit?.sha256, expectedValueAuditSha256, 'manifest audit SHA');

validateRecommendationValueV8StateModel(model.finalStateModel);
validateRecommendationValueV8ActionModel(model.actionModel);

const loadedPredictions = await loadPredictions(paths.predictions);
if (loadedPredictions.rows.length === 0) throw new Error('Value V8 prediction artifact is empty.');
const predictionDiagnostics = summarizePredictions(
  loadedPredictions.rows,
  loadedPredictions.invalidRowCount,
);
const replayRows = loadedPredictions.rows.slice(0, Math.min(1000, loadedPredictions.rows.length));
const ids = new Set(replayRows.map((row) => row.decisionId));
const datasetManifest = JSON.parse(await readFile(join(datasetDirectory, 'manifest.json'), 'utf8'));
assertEqual(datasetManifest.artifact?.sha256, expectedDatasetSha256, 'Dataset manifest SHA-256');
const datasetPath = join(datasetDirectory, datasetManifest.artifact.fileName);
assertEqual(await hashFile(datasetPath), expectedDatasetSha256, 'Dataset artifact SHA-256');
const datasetRows = await loadSelectedRows(datasetPath, ids);

const deterministic = deterministicReplay(
  replayRows,
  datasetRows,
  model.finalStateModel,
  model.actionModel,
  model.options?.maximumAbsolutePrediction ?? 1,
  model.options?.maximumAbsoluteResidual ?? 1,
);
const runtime = runtimeProbe(
  replayRows,
  datasetRows,
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
  challengerNonTrivialRankingRate: predictionDiagnostics.nonTrivialRankingRate,
};

const gateChecks = {
  boundedAuditPassed: audit.passed === true,
  boundedDiagnosticArtifactEligible: audit.diagnosticArtifactEligible === true,
  boundedDiagnosticGatePassed: manifest.diagnosticGatePassed === true,
  boundedFullTrainingRecommended: manifest.fullTrainingRecommended === true,
  boundedDiagnosticOnly: manifest.diagnosticOnly === true,
  boundedMaxRows: audit.build?.maxRows === 50_000,
  futureNotTraining: audit.leakage?.futureTestUsedForTraining === false && evaluation.futureTest?.usedForTraining === false,
  futureNotSelection: audit.leakage?.futureTestUsedForSelection === false && evaluation.futureTest?.usedForSelection === false,
  futureNotEvaluated: evaluation.futureTest?.evaluated === false,
  predictionArtifactHasNoFutureRows: predictionDiagnostics.futureTestRowCount === 0,
  predictionRowsValid: predictionDiagnostics.invalidRowCount === 0,
  deterministicReplayComplete: deterministic.replayedDecisionCount === replayRows.length,
  deterministicRepeatedInference: deterministic.repeatMismatchCount === 0,
  deterministicStoredPredictionMatch: deterministic.storedPredictionMismatchCount === 0,
  replayUsesTuningOnly: deterministic.nonTuningRowCount === 0,
  candidateRankingNonTrivial: predictionDiagnostics.nonTrivialRankingRate > 0,
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
    manifest.source?.behavioral?.sha256 === expectedBehavioralPropensitySha256 &&
    model.behavioralPropensitySha256 === expectedBehavioralPropensitySha256,
};
const failed = Object.entries(gateChecks).filter(([, passed]) => passed !== true).map(([name]) => name);
const evidence = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_VALUE_V8_OFFLINE_VERIFICATION_V5_2',
  generatedAt: new Date().toISOString(),
  lineage: {
    datasetSha256: expectedDatasetSha256,
    behavioralPropensitySha256: expectedBehavioralPropensitySha256,
    valueManifestSha256: expectedValueManifestSha256,
    valueModelSha256: expectedValueModelSha256,
    valuePredictionsSha256: expectedValuePredictionsSha256,
    valueEvaluationSha256: expectedValueEvaluationSha256,
    valueAuditSha256: expectedValueAuditSha256,
  },
  predictionDiagnostics,
  deterministicReplay: deterministic,
  stateOnlyComparison,
  runtime,
  gateChecks,
  offlineVerificationPassed: failed.length === 0,
  fullValueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};
await writeFile(evidencePath, `${JSON.stringify(evidence, undefined, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
if (failed.length > 0) throw new Error(`Value V8 offline verification failed: ${failed.join(', ')}.`);

function validateRequest(value) {
  if (
    value?.schemaVersion !== 1 ||
    value?.operation !== 'RECOMMENDATION_VALUE_V8_OFFLINE_VERIFICATION_V5_2' ||
    value?.offlineVerificationAuthorized !== true ||
    value?.fullValueV8TrainingAuthorized !== false ||
    value?.productionRankingChanged !== false ||
    value?.passiveShadowAuthorized !== false ||
    value?.randomizedCanaryAuthorized !== false
  ) throw new Error('Invalid Value V8 offline-verification request.');
}
function validateValueArtifacts(valueManifest, valueEvaluation, valueAudit) {
  if (
    valueManifest.diagnosticOnly !== true ||
    valueManifest.futureTestUsed !== false ||
    valueManifest.auditPassed !== true ||
    valueManifest.diagnosticGatePassed !== true ||
    valueManifest.fullTrainingRecommended !== true ||
    valueAudit.passed !== true ||
    valueAudit.diagnosticArtifactEligible !== true ||
    valueAudit.build?.diagnosticOnly !== true ||
    valueAudit.build?.maxRows !== 50_000 ||
    valueAudit.build?.fullCorpus !== false ||
    valueAudit.leakage?.futureTestUsedForTraining !== false ||
    valueAudit.leakage?.futureTestUsedForSelection !== false ||
    valueEvaluation.diagnosticGate?.passed !== true ||
    valueEvaluation.diagnosticGate?.fullTrainingRecommended !== true ||
    valueEvaluation.futureTest?.evaluated !== false ||
    valueManifest.source?.dataset?.sha256 !== expectedDatasetSha256 ||
    valueManifest.source?.behavioral?.sha256 !== expectedBehavioralPropensitySha256
  ) throw new Error('Bounded Value V8 artifact is not eligible for offline verification.');
}
async function loadPredictions(path) {
  const rows = [];
  let invalidRowCount = 0;
  for await (const line of linesFromPath(path)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (
        typeof row.decisionId !== 'string' ||
        typeof row.matchId !== 'string' ||
        row.split !== 'TUNING' ||
        !row.statePredictions ||
        !row.candidatePrediction ||
        !Array.isArray(row.candidatePrediction.candidates)
      ) invalidRowCount += 1;
      rows.push(row);
    } catch {
      invalidRowCount += 1;
    }
  }
  return { rows, invalidRowCount };
}
function summarizePredictions(rows, loaderInvalidRowCount) {
  let invalidRowCount = loaderInvalidRowCount;
  let futureTestRowCount = 0;
  let nonTrivialRankingCount = 0;
  let separationSum = 0;
  for (const row of rows) {
    if (row.split === 'FUTURE_TEST') futureTestRowCount += 1;
    const separation = Number(row.candidatePrediction?.candidateSeparation);
    if (!Number.isFinite(separation) || !Array.isArray(row.candidatePrediction?.candidates) || row.candidatePrediction.candidates.length < 2) {
      invalidRowCount += 1;
      continue;
    }
    separationSum += separation;
    if (separation > 1e-12) nonTrivialRankingCount += 1;
  }
  return {
    decisionCount: rows.length,
    invalidRowCount,
    futureTestRowCount,
    averageCandidateSeparation: rows.length === 0 ? 0 : separationSum / rows.length,
    nonTrivialRankingRate: rows.length === 0 ? 0 : nonTrivialRankingCount / rows.length,
  };
}
async function loadSelectedRows(path, selectedIds) {
  const rows = new Map();
  for await (const line of linesFromPath(path)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!selectedIds.has(row.decisionId)) continue;
    rows.set(row.decisionId, row);
    if (rows.size === selectedIds.size) break;
  }
  if (rows.size !== selectedIds.size) throw new Error(`Offline replay join incomplete: expected ${selectedIds.size}, found ${rows.size}.`);
  return rows;
}
function deterministicReplay(predictionRows, datasetRows, stateModel, actionModel, maxState, maxResidual) {
  let replayedDecisionCount = 0;
  let repeatMismatchCount = 0;
  let storedPredictionMismatchCount = 0;
  let nonTuningRowCount = 0;
  for (const stored of predictionRows) {
    const row = datasetRows.get(stored.decisionId);
    nonTuningRowCount += row.split === 'TUNING' ? 0 : 1;
    const state1 = predictRecommendationValueV8State(stateModel, row, maxState);
    const candidates1 = predictRecommendationValueV8CandidateSet(actionModel, row, row.candidates, maxResidual);
    const state2 = predictRecommendationValueV8State(stateModel, row, maxState);
    const candidates2 = predictRecommendationValueV8CandidateSet(actionModel, row, row.candidates, maxResidual);
    if (stableJson(state1) !== stableJson(state2) || stableJson(candidates1) !== stableJson(candidates2)) repeatMismatchCount += 1;
    if (stableJson(state1) !== stableJson(stored.statePredictions) || stableJson(candidates1) !== stableJson(stored.candidatePrediction)) storedPredictionMismatchCount += 1;
    replayedDecisionCount += 1;
  }
  return { requestedDecisionCount: predictionRows.length, replayedDecisionCount, repeatMismatchCount, storedPredictionMismatchCount, nonTuningRowCount };
}
function runtimeProbe(predictionRows, datasetRows, stateModel, actionModel, maxState, maxResidual) {
  const latencies = [];
  const before = process.memoryUsage().heapUsed;
  let peak = before;
  for (const stored of predictionRows) {
    const row = datasetRows.get(stored.decisionId);
    const started = performance.now();
    predictRecommendationValueV8State(stateModel, row, maxState);
    predictRecommendationValueV8CandidateSet(actionModel, row, row.candidates, maxResidual);
    latencies.push(performance.now() - started);
    peak = Math.max(peak, process.memoryUsage().heapUsed);
  }
  const after = process.memoryUsage().heapUsed;
  latencies.sort((a, b) => a - b);
  return {
    decisionCount: latencies.length,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      maximum: latencies.at(-1) ?? 0,
      mean: latencies.length === 0 ? 0 : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
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
  for await (const line of lines) yield line;
}
async function hashFile(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function percentile(sorted, fraction) { if (sorted.length === 0) return 0; return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]; }
function requiredString(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing required environment variable ${name}.`); return value; }
function requiredSha256(name) { const value = requiredString(name); if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a lowercase SHA-256 value.`); return value; }
function assertEqual(actual, expected, label) { if (actual !== expected) throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`); }
