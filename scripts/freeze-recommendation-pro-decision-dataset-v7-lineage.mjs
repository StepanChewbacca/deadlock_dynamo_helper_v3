import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const fullDatasetPath = required('BEHAVIORAL_V7_FULL_SOURCE_DATASET_PATH');
const nonFutureDatasetPath = required('BEHAVIORAL_V7_NON_FUTURE_DATASET_PATH');
const outputPath = required('BEHAVIORAL_V7_DATASET_LINEAGE_OUTPUT_PATH');

const [fullPhysicalSha256, nonFuturePhysicalSha256, fullLogical, nonFutureLogical] =
  await Promise.all([
    hashPhysical(fullDatasetPath),
    hashPhysical(nonFutureDatasetPath),
    hashLogicalFullDataset(fullDatasetPath),
    hashLogicalNonFutureDataset(nonFutureDatasetPath),
  ]);

if (fullLogical.nonFutureSha256 !== nonFutureLogical.sha256) {
  throw new Error(
    `Dataset V7 non-FUTURE logical SHA mismatch: ${fullLogical.nonFutureSha256} versus ${nonFutureLogical.sha256}.`,
  );
}
if (fullLogical.nonFutureRowCount !== nonFutureLogical.rowCount) {
  throw new Error(
    `Dataset V7 non-FUTURE row-count mismatch: ${fullLogical.nonFutureRowCount} versus ${nonFutureLogical.rowCount}.`,
  );
}
if (fullLogical.futureTestRowCount <= 0) {
  throw new Error('Dataset V7 immutable source has no FUTURE_TEST rows.');
}
if (nonFutureLogical.futureTestRowCount !== 0) {
  throw new Error('Dataset V7 non-FUTURE view contains FUTURE_TEST rows.');
}

const manifest = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_PRO_DECISION_DATASET_V7_IMMUTABLE_LINEAGE',
  generatedAt: new Date().toISOString(),
  datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1',
  observabilityVersion: 'RECOMMENDATION_OBSERVABILITY_V7_STRICT_PREDECISION_1',
  fullSource: {
    path: fullDatasetPath,
    physicalSha256: fullPhysicalSha256,
    logicalSha256: fullLogical.sha256,
    rowCount: fullLogical.rowCount,
    trainRowCount: fullLogical.trainRowCount,
    tuningRowCount: fullLogical.tuningRowCount,
    futureTestRowCount: fullLogical.futureTestRowCount,
  },
  nonFutureView: {
    path: nonFutureDatasetPath,
    physicalSha256: nonFuturePhysicalSha256,
    logicalSha256: nonFutureLogical.sha256,
    rowCount: nonFutureLogical.rowCount,
    trainRowCount: nonFutureLogical.trainRowCount,
    tuningRowCount: nonFutureLogical.tuningRowCount,
    futureTestRowCount: nonFutureLogical.futureTestRowCount,
  },
  contracts: {
    immutableFullSource: true,
    nonFutureViewDefinition: 'EXACT_FULL_SOURCE_ROWS_WHERE_SPLIT_NE_FUTURE_TEST',
    nonFutureLogicalShaMatchesFullSourceProjection: true,
    futureTestExcludedFromNonFutureView: true,
    futureTestUsedForTraining: false,
    futureTestUsedForSelection: false,
    trainingPerformed: false,
  },
  lineagePassed: true,
  trainingArtifactEligible: false,
  productionRankingChanged: false,
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(manifest, null, 2));

async function hashLogicalFullDataset(path) {
  const allHash = createHash('sha256');
  const nonFutureHash = createHash('sha256');
  let rowCount = 0;
  let trainRowCount = 0;
  let tuningRowCount = 0;
  let futureTestRowCount = 0;
  const input = createInterface({ input: openDataset(path), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    assertDatasetV7Row(row);
    const normalized = `${line.trimEnd()}\n`;
    allHash.update(normalized);
    rowCount += 1;
    if (row.split === 'TRAIN') trainRowCount += 1;
    if (row.split === 'TUNING') tuningRowCount += 1;
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
    } else {
      nonFutureHash.update(normalized);
    }
  }
  return {
    sha256: allHash.digest('hex'),
    nonFutureSha256: nonFutureHash.digest('hex'),
    rowCount,
    nonFutureRowCount: trainRowCount + tuningRowCount,
    trainRowCount,
    tuningRowCount,
    futureTestRowCount,
  };
}

async function hashLogicalNonFutureDataset(path) {
  const hash = createHash('sha256');
  let rowCount = 0;
  let trainRowCount = 0;
  let tuningRowCount = 0;
  let futureTestRowCount = 0;
  const input = createInterface({ input: openDataset(path), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    assertDatasetV7Row(row);
    if (row.split === 'FUTURE_TEST') futureTestRowCount += 1;
    if (row.split === 'TRAIN') trainRowCount += 1;
    if (row.split === 'TUNING') tuningRowCount += 1;
    hash.update(`${line.trimEnd()}\n`);
    rowCount += 1;
  }
  return {
    sha256: hash.digest('hex'),
    rowCount,
    trainRowCount,
    tuningRowCount,
    futureTestRowCount,
  };
}

function assertDatasetV7Row(row) {
  if (
    row?.schemaVersion !== 1 ||
    row?.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1' ||
    row?.observabilityVersion !== 'RECOMMENDATION_OBSERVABILITY_V7_STRICT_PREDECISION_1' ||
    !['TRAIN', 'TUNING', 'FUTURE_TEST'].includes(row?.split)
  ) {
    throw new Error('Invalid Dataset V7 row while freezing immutable lineage.');
  }
}

async function hashPhysical(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function openDataset(path) {
  const stream = createReadStream(path);
  return path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
