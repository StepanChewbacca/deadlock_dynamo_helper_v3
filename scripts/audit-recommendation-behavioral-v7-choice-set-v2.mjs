import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const datasetPath = required('BEHAVIORAL_V7_DATASET_PATH');
const outputPath = required('BEHAVIORAL_V7_CHOICE_SET_REPORT_PATH');
const compactRowsPath = required('BEHAVIORAL_V7_COMPACT_ROWS_PATH');
const referencePath = process.env.BEHAVIORAL_V6_TOP96_REPORT_PATH?.trim();
const majorGroupMinDecisions = 100;

const groups = new Map();
const candidateCounts = [];
let selectedRowCount = 0;
let observedCoveredCount = 0;
let futureTestRowCount = 0;
let compactRowCount = 0;
let availabilityAwareDecisionCount = 0;
let unavailableCandidateCount = 0;
let availabilityEvaluatedCandidateCount = 0;
let observedActionInjectionViolationCount = 0;

const compactOutput = createWriteStream(compactRowsPath, { encoding: 'utf8' });
const input = createInterface({ input: openDataset(datasetPath), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  assertV7Row(row);
  if (row.split === 'FUTURE_TEST') {
    futureTestRowCount += 1;
    continue;
  }

  selectedRowCount += 1;
  if (
    row.choiceSet?.observedActionInjected === true ||
    row.choiceSet?.selectedAfterObservedAction === true
  ) {
    observedActionInjectionViolationCount += 1;
  }

  const selection = selectActionKeys(row.candidates);
  candidateCounts.push(selection.actionKeys.length);
  availabilityAwareDecisionCount +=
    selection.availabilityEvaluatedCount > 0 ? 1 : 0;
  unavailableCandidateCount += selection.unavailableCount;
  availabilityEvaluatedCandidateCount += selection.availabilityEvaluatedCount;
  const covered = selection.actionKeys.includes(String(row.observedActionKey));
  observedCoveredCount += covered ? 1 : 0;

  for (const key of groupKeys(row)) {
    observeGroup(groups, key, covered, selection.actionKeys.length);
  }

  const compactRow = {
    schemaVersion: 1,
    split: row.split,
    matchId: row.matchId,
    observedActionKey: String(row.observedActionKey),
    eligibility: {
      behavioralModel: row.eligibility?.behavioralModel === true,
    },
    state: {
      heroId: row.state?.heroId,
      phase: row.state?.phase,
      gameTimeS: row.state?.gameTimeS,
      netWorth: row.state?.netWorth,
      inventoryItemCount: row.state?.inventoryItemCount,
      previousActionKey: row.state?.previousActionKey,
    },
    observability: (row.observability ?? []).map((observation) => ({
      fieldName: observation.fieldName,
      ...(observation.value === undefined ? {} : { value: observation.value }),
      missing: observation.missing === true,
    })),
    behavioralChoiceSetActionKeys: selection.actionKeys,
  };
  await writeLine(compactOutput, `${JSON.stringify(compactRow)}\n`);
  compactRowCount += 1;
}
await endStream(compactOutput);

const groupMetrics = [...groups.entries()]
  .map(([key, value]) => ({
    key,
    decisionCount: value.decisions,
    observedActionCoverage: value.covered / value.decisions,
    meanCandidateCount: value.candidateCountSum / value.decisions,
    major: value.decisions >= majorGroupMinDecisions,
  }))
  .sort((left, right) =>
    left.key.localeCompare(right.key, undefined, { numeric: true }),
  );
const majorLowCoverageGroups = groupMetrics.filter(
  (group) => group.major && group.observedActionCoverage < 0.95,
);
const overallCoverage = ratio(observedCoveredCount, selectedRowCount);
const availabilityMode =
  availabilityAwareDecisionCount > 0
    ? 'OBSERVED_AVAILABILITY_FILTER_TOP96'
    : 'NO_AVAILABILITY_SIGNAL_KEEP_TOP96';
const reference = referencePath
  ? JSON.parse(await readFile(referencePath, 'utf8'))
  : undefined;
const report = {
  schemaVersion: 3,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_FEASIBLE_CHOICE_SET_AUDIT',
  executorVersion: 'V7_COMPACT_SIDECAR_OBSERVED_AVAILABILITY_AUDIT_3',
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  availabilityMode,
  contract: {
    selectionUsesObservedAction: false,
    unknownAvailabilityRetained: true,
    explicitlyUnavailableRemovedOnlyWhenObserved: true,
    noAvailabilitySignalPreservesSafeTop96: true,
    maximumCandidates: 96,
    minimumOverallObservedActionCoverage: 0.99,
    minimumMajorGroupObservedActionCoverage: 0.95,
    compactRowsUseIdenticalBehavioralChoiceSet: true,
  },
  source: {
    datasetPath,
    compactRowsPath,
    referenceV6Top96Path: referencePath,
    selectedRowCount,
    compactRowCount,
    futureTestRowCount,
  },
  metrics: {
    observedActionCoverage: overallCoverage,
    observedCoveredCount,
    availabilityAwareDecisionCount,
    availabilityAwareDecisionRate: ratio(
      availabilityAwareDecisionCount,
      selectedRowCount,
    ),
    availabilityEvaluatedCandidateCount,
    unavailableCandidateCount,
    candidateCount: distribution(candidateCounts),
    majorLowCoverageGroupCount: majorLowCoverageGroups.length,
    majorLowCoverageGroups,
    groups: groupMetrics,
  },
  reference: summarizeReference(reference),
  gates: {
    futureTestExcluded: futureTestRowCount === 0,
    observedActionNeverInjected: observedActionInjectionViolationCount === 0,
    overallCoverageAtLeast099: overallCoverage >= 0.99,
    allMajorGroupsAtLeast095: majorLowCoverageGroups.length === 0,
    availabilityModeExplicitlyDocumented:
      availabilityMode === 'OBSERVED_AVAILABILITY_FILTER_TOP96' ||
      availabilityMode === 'NO_AVAILABILITY_SIGNAL_KEEP_TOP96',
    compactRowsComplete:
      compactRowCount === selectedRowCount && compactRowCount > 0,
  },
};
report.stageDGatePassed = Object.values(report.gates).every(Boolean);
report.nextAuthorizedOperation = report.stageDGatePassed
  ? 'STAGE_E_INFORMATION_GAIN_DIAGNOSTIC'
  : 'REVISE_V7_CHOICE_SET_WITHOUT_OBSERVED_ACTION_INJECTION';
report.nextStep = report.stageDGatePassed
  ? 'RUN_INFORMATION_GAIN_GATE_V3'
  : 'REVISE_V7_CHOICE_SET_WITHOUT_OBSERVED_ACTION_INJECTION';
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      stageDGatePassed: report.stageDGatePassed,
      nextAuthorizedOperation: report.nextAuthorizedOperation,
      availabilityMode,
      compactRowCount,
      metrics: report.metrics,
      gates: report.gates,
    },
    null,
    2,
  ),
);

function selectActionKeys(candidates) {
  const ordered = [...candidates].sort(
    (left, right) =>
      Number(left.rank) - Number(right.rank) ||
      Number(right.generatorScore) - Number(left.generatorScore) ||
      String(left.actionKey).localeCompare(String(right.actionKey)),
  );
  const availabilityEvaluatedCount = ordered.filter(
    (candidate) => candidate.feasibility?.evaluated === true,
  ).length;
  const unavailableCount = ordered.filter(
    (candidate) =>
      candidate.feasibility?.evaluated === true &&
      candidate.feasibility?.feasible === false,
  ).length;
  const actionKeys = ordered
    .filter(
      (candidate) =>
        candidate.feasibility?.evaluated !== true ||
        candidate.feasibility?.feasible === true,
    )
    .slice(0, 96)
    .map((candidate) => String(candidate.actionKey));
  return { actionKeys, availabilityEvaluatedCount, unavailableCount };
}

function groupKeys(row) {
  const gameTimeS = Number(row.state?.gameTimeS ?? 0);
  const netWorth = Number(row.state?.netWorth);
  return [
    `PHASE:${row.state?.phase ?? 'UNKNOWN'}`,
    `HERO:${row.state?.heroId ?? 'UNKNOWN'}`,
    `TIME:${Math.floor(gameTimeS / 300) * 5}-${Math.floor(gameTimeS / 300) * 5 + 5}m`,
    `ECONOMY:${economyBand(netWorth)}`,
  ];
}

function economyBand(value) {
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if (value < 5000) return 'LT_5000';
  if (value < 10000) return '5000_9999';
  if (value < 15000) return '10000_14999';
  if (value < 20000) return '15000_19999';
  return 'GE_20000';
}

function observeGroup(map, key, covered, candidateCount) {
  const value = map.get(key) ?? {
    decisions: 0,
    covered: 0,
    candidateCountSum: 0,
  };
  value.decisions += 1;
  value.covered += covered ? 1 : 0;
  value.candidateCountSum += candidateCount;
  map.set(key, value);
}

function openDataset(path) {
  const stream = createReadStream(path);
  return path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
}

function distribution(values) {
  if (values.length === 0) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function quantile(sorted, q) {
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarizeReference(reference) {
  if (!reference) return undefined;
  return {
    operation: reference.operation,
    selectedDefinition:
      reference.selectedDefinition ?? reference.selected?.definition,
    observedActionCoverage:
      reference.selected?.observedActionCoverage ??
      reference.observedActionCoverage,
    candidateCount:
      reference.selected?.candidateCount ?? reference.candidateCount,
  };
}

function assertV7Row(row) {
  if (
    row?.schemaVersion !== 1 ||
    row?.datasetVersion !==
      'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1' ||
    !Array.isArray(row?.candidates)
  ) {
    throw new Error('Unsupported Dataset V7 row.');
  }
}

async function writeLine(stream, value) {
  if (!stream.write(value)) await once(stream, 'drain');
}

async function endStream(stream) {
  stream.end();
  await once(stream, 'finish');
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
