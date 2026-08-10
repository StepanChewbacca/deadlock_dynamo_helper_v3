import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const V52_SCHEMA_VERSION = 1;
const V52_MODEL_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V5_2_LOW_RANK_TWO_TOWER_1_RAW_PROPENSITY';
const V52_FEATURE_VERSION = 'RECOMMENDATION_BEHAVIORAL_V5_2_FEATURES_1_TWO_TOWER';

const path = requiredString('BEHAVIORAL_V5_2_PROPENSITY_PATH');
const expectedSha256 = requiredSha256('EXPECTED_BEHAVIORAL_PROPENSITY_SHA256');
const expectedDatasetSha256 = requiredSha256('EXPECTED_DATASET_SHA256');

const actualSha256 = await hashFile(path);
assertEqual(actualSha256, expectedSha256, 'Behavioral V5.2 propensity SHA-256');

let rowCount = 0;
let invalidRowCount = 0;
let trainRowCount = 0;
let tuningRowCount = 0;
let futureTestRowCount = 0;
let oofRowCount = 0;
let fullTrainRowCount = 0;
let candidateRowCount = 0;
let minimumProbability = Number.POSITIVE_INFINITY;
let maximumProbability = 0;
let maximumNormalizationError = 0;

for await (const line of linesFromMaybeGzip(path)) {
  if (!line.trim()) continue;
  rowCount += 1;
  try {
    const row = JSON.parse(line);
    const valid = validateRow(row);
    if (!valid) {
      invalidRowCount += 1;
      continue;
    }

    if (row.split === 'TRAIN') trainRowCount += 1;
    if (row.split === 'TUNING') tuningRowCount += 1;
    if (row.split === 'FUTURE_TEST') futureTestRowCount += 1;
    if (row.predictionSource === 'CROSS_FITTED_OOF') oofRowCount += 1;
    if (row.predictionSource === 'FULL_TRAIN_MODEL') fullTrainRowCount += 1;

    let total = 0;
    for (const candidate of row.candidates) {
      candidateRowCount += 1;
      total += candidate.probability;
      minimumProbability = Math.min(minimumProbability, candidate.probability);
      maximumProbability = Math.max(maximumProbability, candidate.probability);
    }
    maximumNormalizationError = Math.max(
      maximumNormalizationError,
      Math.abs(total - 1),
    );
  } catch {
    invalidRowCount += 1;
  }
}

if (rowCount === 0) {
  throw new Error('Behavioral V5.2 propensity artifact is empty.');
}
if (invalidRowCount > 0) {
  throw new Error(
    `Behavioral V5.2 propensity audit failed: rows=${rowCount}, invalid=${invalidRowCount}.`,
  );
}
if (futureTestRowCount !== 0) {
  throw new Error(
    `Behavioral V5.2 propensity artifact unexpectedly contains ${futureTestRowCount} FUTURE_TEST rows.`,
  );
}
if (trainRowCount === 0 || tuningRowCount === 0) {
  throw new Error('Behavioral V5.2 propensity artifact requires TRAIN and TUNING rows.');
}
if (oofRowCount !== trainRowCount) {
  throw new Error(
    `TRAIN OOF count mismatch: train=${trainRowCount}, oof=${oofRowCount}.`,
  );
}
if (fullTrainRowCount !== tuningRowCount) {
  throw new Error(
    `TUNING full-TRAIN count mismatch: tuning=${tuningRowCount}, fullTrain=${fullTrainRowCount}.`,
  );
}

const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V5_2_PROPENSITY_FULL_STREAM_AUDIT',
  sha256: actualSha256,
  sourceDatasetSha256: expectedDatasetSha256,
  rowCount,
  trainRowCount,
  tuningRowCount,
  futureTestRowCount,
  oofRowCount,
  fullTrainRowCount,
  candidateRowCount,
  invalidRowCount,
  minimumProbability:
    minimumProbability === Number.POSITIVE_INFINITY ? 0 : minimumProbability,
  maximumProbability,
  maximumNormalizationError,
  rawSoftmaxContractPassed: true,
  propensityFloorApplied: false,
  ipsClippingAppliedInBehavioral: false,
  futureTestUsed: false,
};

console.log(JSON.stringify(report, null, 2));

function validateRow(row) {
  if (
    row?.schemaVersion !== V52_SCHEMA_VERSION ||
    row?.modelVersion !== V52_MODEL_VERSION ||
    row?.featureVersion !== V52_FEATURE_VERSION ||
    row?.sourceDatasetSha256 !== expectedDatasetSha256 ||
    !['TRAIN', 'TUNING'].includes(row?.split) ||
    typeof row?.decisionId !== 'string' ||
    typeof row?.matchId !== 'string' ||
    row?.probabilityContract !== 'RAW_SOFTMAX_WITHIN_DECISION' ||
    row?.propensityFloorApplied !== false ||
    !Number.isFinite(row?.observedActionRawProbability) ||
    row.observedActionRawProbability <= 0 ||
    row?.observedActionProbability !== row?.observedActionRawProbability ||
    !Array.isArray(row?.candidates) ||
    row.candidates.length < 2
  ) {
    return false;
  }

  if (
    row.split === 'TRAIN' &&
    (row.predictionSource !== 'CROSS_FITTED_OOF' ||
      !Number.isSafeInteger(row.foldId) ||
      row.foldId < 0 ||
      row.trainingMatchExcluded !== true)
  ) {
    return false;
  }
  if (
    row.split === 'TUNING' &&
    (row.predictionSource !== 'FULL_TRAIN_MODEL' ||
      row.trainingMatchExcluded !== true)
  ) {
    return false;
  }

  let total = 0;
  let observedProbability;
  for (const candidate of row.candidates) {
    if (
      typeof candidate?.actionKey !== 'string' ||
      !Number.isFinite(candidate?.probability) ||
      candidate.probability <= 0 ||
      candidate.probability !== candidate.rawProbability
    ) {
      return false;
    }
    total += candidate.probability;
    if (candidate.actionKey === row.observedActionKey) {
      observedProbability = candidate.probability;
    }
  }
  return (
    Number.isFinite(total) &&
    Math.abs(total - 1) <= 1e-9 &&
    observedProbability === row.observedActionProbability
  );
}

async function* linesFromMaybeGzip(filePath) {
  const raw = createReadStream(filePath);
  const input = filePath.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) yield line;
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function requiredString(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
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
