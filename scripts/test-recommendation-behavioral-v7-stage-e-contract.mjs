import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = await mkdtemp(
  join(tmpdir(), 'behavioral-v7-stage-e-contract-'),
);
try {
  await verifyCurrentStageDContract();
  await verifyLegacyGateAliasesFailClosed();
  console.log('Behavioral V7 Stage E contract regression PASS');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function verifyCurrentStageDContract() {
  const datasetPath = join(workspace, 'compact.ndjson');
  const stageDPath = join(workspace, 'stage-d.json');
  const outputPath = join(workspace, 'stage-e.json');
  await writeFile(datasetPath, buildCompactRows(), 'utf8');
  await writeFile(
    stageDPath,
    `${JSON.stringify(stageDReport(), null, 2)}\n`,
    'utf8',
  );

  const result = runStageE(datasetPath, stageDPath, outputPath);
  assert(
    result.status === 2,
    `Expected information-gain FAIL exit 2, got ${result.status}: ${result.stderr}`,
  );
  const report = JSON.parse(await readFile(outputPath, 'utf8'));
  assert(report.schemaVersion === 6, 'Stage E schemaVersion must be 6.');
  assert(
    report.stageDValidation?.passed === true,
    'Current Stage D v3 contract must be accepted.',
  );
  assert(
    report.source?.trainPartitionDecisionCounts?.every((count) => count >= 1000),
    'All TRAIN partitions must reach the runtime diagnostic.',
  );
  assert(
    report.source?.tuningDecisionCount >= 1000,
    'Independent TUNING must reach the runtime diagnostic.',
  );
  assert(report.stageEGatePassed === false, 'No-gain fixture must fail Stage E.');
  assert(
    report.nextAuthorizedOperation === 'COLLECT_NEW_OBSERVABILITY_TELEMETRY',
    'Failed information gain must not authorize Stage F.',
  );
  assert(
    report.failure === undefined,
    'Valid Stage D contract must not fail as a schema error.',
  );
}

async function verifyLegacyGateAliasesFailClosed() {
  const datasetPath = join(workspace, 'unused.ndjson');
  const stageDPath = join(workspace, 'stage-d-legacy-aliases.json');
  const outputPath = join(workspace, 'stage-e-legacy-aliases.json');
  await writeFile(datasetPath, '', 'utf8');
  const report = stageDReport();
  report.gates = {
    overallCandidateCoveragePass: true,
    allMajorGroupCoveragePass: true,
    overallDecisionCoveragePass: true,
    allMajorGroupDecisionCoveragePass: true,
    exactRankingSemanticsPass: true,
    futureTestExcluded: true,
  };
  await writeFile(
    stageDPath,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  const result = runStageE(datasetPath, stageDPath, outputPath);
  assert(result.status !== 0, 'Unknown/legacy Stage D gate aliases must fail closed.');
  const evidence = JSON.parse(await readFile(outputPath, 'utf8'));
  assert(
    evidence.stageEGatePassed === false,
    'Rejected Stage D contract must persist failed Stage E evidence.',
  );
  assert(
    evidence.nextAuthorizedOperation === 'STOP_BEFORE_BEHAVIORAL_V7_TRAINING',
    'Rejected Stage D contract must block training.',
  );
  assert(
    evidence.stageDValidation?.passed === false,
    'Legacy aliases must not be silently accepted.',
  );
}

function runStageE(datasetPath, stageDPath, outputPath) {
  return spawnSync(
    process.execPath,
    ['scripts/diagnose-recommendation-behavioral-v7-information-gain-v3.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BEHAVIORAL_V7_COMPACT_ROWS_PATH: datasetPath,
        BEHAVIORAL_V7_STAGE_D_PATH: stageDPath,
        BEHAVIORAL_V7_INFORMATION_GAIN_REPORT_PATH: outputPath,
      },
      encoding: 'utf8',
    },
  );
}

function stageDReport() {
  return {
    schemaVersion: 3,
    operation: 'RECOMMENDATION_BEHAVIORAL_V7_FEASIBLE_CHOICE_SET_AUDIT',
    futureTestEvaluated: false,
    contract: {
      selectionUsesObservedAction: false,
      compactRowsUseIdenticalBehavioralChoiceSet: true,
      maximumCandidates: 96,
    },
    gates: {
      futureTestExcluded: true,
      observedActionNeverInjected: true,
      overallCoverageAtLeast099: true,
      allMajorGroupsAtLeast095: true,
      availabilityModeExplicitlyDocumented: true,
      compactRowsComplete: true,
    },
    stageDGatePassed: true,
  };
}

function buildCompactRows() {
  const rows = [];
  const trainCounts = [0, 0, 0];
  let match = 1;
  while (trainCounts.some((count) => count < 1100)) {
    const matchId = `train-${match}`;
    const partition = fnv1a32(matchId) % trainCounts.length;
    match += 1;
    if (trainCounts[partition] >= 1100) continue;
    trainCounts[partition] += 1;
    rows.push(compactRow('TRAIN', matchId, trainCounts[partition]));
  }
  for (let index = 0; index < 1100; index += 1) {
    rows.push(compactRow('TUNING', `tuning-${index}`, index));
  }
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function compactRow(split, matchId, index) {
  return {
    schemaVersion: 1,
    split,
    matchId,
    observedActionKey: 'A',
    eligibility: { behavioralModel: true },
    state: {
      heroId: 1,
      phase: 'LATE',
      gameTimeS: 2400 + (index % 30),
      netWorth: 22000,
      inventoryItemCount: 6,
      previousActionKey: 'P',
    },
    observability: [
      {
        fieldName: 'EXACT_SLOT_LEGALITY',
        value: 'KNOWN',
        missing: false,
      },
    ],
    behavioralChoiceSetActionKeys: ['A', 'B'],
  };
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
