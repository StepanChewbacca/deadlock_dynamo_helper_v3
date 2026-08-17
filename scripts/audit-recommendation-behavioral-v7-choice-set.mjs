import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const datasetPath = required('BEHAVIORAL_V7_DATASET_PATH');
const outputPath = required('BEHAVIORAL_V7_CHOICE_SET_REPORT_PATH');
const referencePath = process.env.BEHAVIORAL_V6_TOP96_REPORT_PATH?.trim();
const majorGroupMinDecisions = 100;
const minimumOverallCoverage = 0.99;
const minimumMajorGroupCoverage = 0.95;
const expectedDefinition = 'V7_OBSERVED_AVAILABILITY_TOP96_1';

const groups = new Map();
const candidateCounts = [];
let selectedRowCount = 0;
let candidateCoveredCount = 0;
let decisionCoveredCount = 0;
let futureTestRowCount = 0;
let availabilityAwareDecisionCount = 0;
let unavailableCandidateCount = 0;
let availabilityEvaluatedCandidateCount = 0;
let observedActionInjectionViolationCount = 0;
let rankingSemanticViolationCount = 0;

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
  const coverageUniverse = new Set(row.candidates.map((candidate) => String(candidate.actionKey)));
  const candidateCovered = coverageUniverse.has(String(row.observedActionKey));
  candidateCoveredCount += candidateCovered ? 1 : 0;

  if (row.choiceSet?.observedActionInjected === true || row.choiceSet?.selectedAfterObservedAction === true) {
    observedActionInjectionViolationCount += 1;
  }

  const expected = selectActionKeys(row.candidates);
  const persisted = (row.choiceSet?.behavioralChoiceSetActionKeys ?? []).map(String);
  const exactRankingSemantics =
    row.choiceSet?.behavioralChoiceSetDefinition === expectedDefinition &&
    arraysEqual(persisted, expected.actionKeys) &&
    arraysEqual(
      (row.choiceSet?.coverageUniverseActionKeys ?? []).map(String),
      row.candidates.map((candidate) => String(candidate.actionKey)),
    );
  rankingSemanticViolationCount += exactRankingSemantics ? 0 : 1;

  candidateCounts.push(expected.actionKeys.length);
  availabilityAwareDecisionCount += expected.availabilityEvaluatedCount > 0 ? 1 : 0;
  unavailableCandidateCount += expected.unavailableCount;
  availabilityEvaluatedCandidateCount += expected.availabilityEvaluatedCount;

  const decisionCovered = expected.actionKeys.includes(String(row.observedActionKey));
  decisionCoveredCount += decisionCovered ? 1 : 0;
  for (const key of groupKeys(row)) {
    observeGroup(groups, key, candidateCovered, decisionCovered, expected.actionKeys.length);
  }
}

const groupMetrics = [...groups.entries()]
  .map(([key, value]) => ({
    key,
    decisionCount: value.decisions,
    candidateCoverage: ratio(value.candidateCovered, value.decisions),
    observedActionCoverage: ratio(value.decisionCovered, value.decisions),
    meanCandidateCount: ratio(value.candidateCountSum, value.decisions),
    major: value.decisions >= majorGroupMinDecisions,
  }))
  .sort((left, right) => left.key.localeCompare(right.key, undefined, { numeric: true }));

const majorCandidateLowCoverageGroups = groupMetrics.filter(
  (group) => group.major && group.candidateCoverage < minimumMajorGroupCoverage,
);
const majorDecisionLowCoverageGroups = groupMetrics.filter(
  (group) => group.major && group.observedActionCoverage < minimumMajorGroupCoverage,
);
const overallCandidateCoverage = ratio(candidateCoveredCount, selectedRowCount);
const overallDecisionCoverage = ratio(decisionCoveredCount, selectedRowCount);
const availabilityMode = availabilityAwareDecisionCount > 0
  ? 'OBSERVED_AVAILABILITY_FILTER_TOP96'
  : 'NO_AVAILABILITY_SIGNAL_KEEP_TOP96';
const reference = referencePath ? JSON.parse(await readFile(referencePath, 'utf8')) : undefined;

const gates = {
  overallCandidateCoveragePass: overallCandidateCoverage >= minimumOverallCoverage,
  allMajorGroupCoveragePass: majorCandidateLowCoverageGroups.length === 0,
  overallDecisionCoveragePass: overallDecisionCoverage >= minimumOverallCoverage,
  allMajorGroupDecisionCoveragePass: majorDecisionLowCoverageGroups.length === 0,
  exactRankingSemanticsPass:
    rankingSemanticViolationCount === 0 && observedActionInjectionViolationCount === 0,
  futureTestExcluded: futureTestRowCount === 0,
};

const report = {
  schemaVersion: 3,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_FEASIBLE_CHOICE_SET_AUDIT',
  executorVersion: 'V7_EXACT_RANKING_CANDIDATE_AND_DECISION_COVERAGE_3',
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  availabilityMode,
  contract: {
    selectionUsesObservedAction: false,
    unknownAvailabilityRetained: true,
    explicitlyUnavailableRemovedOnlyWhenObserved: true,
    noAvailabilitySignalPreservesSafeTop96: true,
    exactRankingSemantics: 'RANK_ASC_GENERATOR_SCORE_DESC_ACTION_KEY_ASC_FILTER_OBSERVED_UNAVAILABLE_THEN_TOP96',
    maximumCandidates: 96,
    minimumOverallCandidateCoverage: minimumOverallCoverage,
    minimumMajorGroupCandidateCoverage: minimumMajorGroupCoverage,
    minimumOverallDecisionCoverage: minimumOverallCoverage,
    minimumMajorGroupDecisionCoverage: minimumMajorGroupCoverage,
  },
  source: {
    datasetPath,
    referenceV6Top96Path: referencePath,
    selectedRowCount,
    futureTestRowCount,
  },
  metrics: {
    candidateCoverage: overallCandidateCoverage,
    observedActionCoverage: overallDecisionCoverage,
    candidateCoveredCount,
    observedCoveredCount: decisionCoveredCount,
    availabilityAwareDecisionCount,
    availabilityAwareDecisionRate: ratio(availabilityAwareDecisionCount, selectedRowCount),
    availabilityEvaluatedCandidateCount,
    unavailableCandidateCount,
    observedActionInjectionViolationCount,
    rankingSemanticViolationCount,
    candidateCount: distribution(candidateCounts),
    majorCandidateLowCoverageGroupCount: majorCandidateLowCoverageGroups.length,
    majorDecisionLowCoverageGroupCount: majorDecisionLowCoverageGroups.length,
    majorCandidateLowCoverageGroups,
    majorDecisionLowCoverageGroups,
    groups: groupMetrics,
  },
  reference: summarizeReference(reference),
  gates,
};
report.stageDGatePassed = Object.values(gates).every(Boolean);
report.nextStep = report.stageDGatePassed
  ? 'RUN_INFORMATION_GAIN_GATE_V3'
  : 'REVISE_V7_CHOICE_SET_WITHOUT_OBSERVED_ACTION_INJECTION';

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ stageDGatePassed: report.stageDGatePassed, availabilityMode, metrics: report.metrics, gates }, null, 2));

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
    (candidate) => candidate.feasibility?.evaluated === true && candidate.feasibility?.feasible === false,
  ).length;
  const actionKeys = ordered
    .filter(
      (candidate) => candidate.feasibility?.evaluated !== true || candidate.feasibility?.feasible === true,
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
function observeGroup(map, key, candidateCovered, decisionCovered, candidateCount) {
  const value = map.get(key) ?? { decisions: 0, candidateCovered: 0, decisionCovered: 0, candidateCountSum: 0 };
  value.decisions += 1;
  value.candidateCovered += candidateCovered ? 1 : 0;
  value.decisionCovered += decisionCovered ? 1 : 0;
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
    mean: ratio(sorted.reduce((sum, value) => sum + value, 0), sorted.length),
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
    selectedDefinition: reference.selectedDefinition ?? reference.selected?.definition,
    observedActionCoverage: reference.selected?.observedActionCoverage ?? reference.observedActionCoverage,
    candidateCount: reference.selected?.candidateCount ?? reference.candidateCount,
  };
}
function assertV7Row(row) {
  if (row?.schemaVersion !== 1 || row?.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1' || !Array.isArray(row?.candidates)) {
    throw new Error('Unsupported Dataset V7 row.');
  }
}
function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function ratio(numerator, denominator) { return denominator > 0 ? numerator / denominator : 0; }
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
