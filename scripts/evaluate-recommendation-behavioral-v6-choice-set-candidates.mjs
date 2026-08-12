import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const rowsPath = required('BEHAVIORAL_V6_CHOICE_SET_ROWS_PATH');
const reportPath = required('BEHAVIORAL_V6_CHOICE_SET_CANDIDATE_REPORT_PATH');
const topNs = [20, 32, 50, 64, 75, 96, 100, 112, 128];
const minimumOverallCoverage = 0.99;
const minimumMajorCohortCoverage = 0.95;
const majorGroupMinDecisions = 100;

const definitions = [
  {
    id: 'PRIMARY_ONLY',
    candidateCount: (row) => row.primaryCandidateCount,
    observed: (row) => row.primaryObserved === true,
  },
  ...topNs.map((limit) => ({
    id: `MERGED_TOP_${limit}`,
    candidateCount: (row) => Math.min(limit, integer(row.mergedCandidateCount)),
    observed: (row) =>
      Number.isFinite(Number(row.mergedObservedRank)) &&
      Number(row.mergedObservedRank) <= limit,
  })),
  ...topNs.map((limit) => ({
    id: `SUPPORT_TOP_${limit}`,
    candidateCount: (row) => Math.min(limit, integer(row.supportCandidateCount)),
    observed: (row) =>
      Number.isFinite(Number(row.supportObservedRank)) &&
      Number(row.supportObservedRank) <= limit,
  })),
];

const accumulators = new Map(
  definitions.map((definition) => [definition.id, createAccumulator(definition.id)]),
);
let rowCount = 0;
let futureTestRowCount = 0;
let malformedRowCount = 0;

const input = createInterface({ input: createReadStream(rowsPath), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    malformedRowCount += 1;
    continue;
  }
  if (row.split === 'FUTURE_TEST') {
    futureTestRowCount += 1;
    continue;
  }
  if (row.split !== 'TRAIN' && row.split !== 'TUNING') continue;
  rowCount += 1;

  for (const definition of definitions) {
    const accumulator = accumulators.get(definition.id);
    const candidateCount = definition.candidateCount(row);
    const observed = definition.observed(row);
    observe(accumulator.overall, observed, candidateCount);
    observeGroup(accumulator.byTimeBucket, String(row.timeBucket ?? 'UNKNOWN'), observed, candidateCount);
    observeGroup(accumulator.byEconomyBand, String(row.economyBand ?? 'UNKNOWN'), observed, candidateCount);
    observeGroup(accumulator.byPhase, String(row.phase ?? 'UNKNOWN'), observed, candidateCount);
    observeGroup(accumulator.byActionType, String(row.actionType ?? 'UNKNOWN'), observed, candidateCount);
  }
}

const variants = definitions.map((definition) => finalizeVariant(accumulators.get(definition.id)));
const passing = variants
  .filter((variant) => variant.gate.passed)
  .sort(
    (left, right) =>
      left.overall.candidateCount.mean - right.overall.candidateCount.mean ||
      right.overall.observedCoverage - left.overall.observedCoverage ||
      left.id.localeCompare(right.id),
  );

const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_CANDIDATE_EVALUATION',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  source: {
    rowCount,
    futureTestRowCount,
    malformedRowCount,
  },
  thresholds: {
    minimumOverallCoverage,
    minimumMajorCohortCoverage,
    majorGroupMinDecisions,
  },
  variants,
  recommendation: {
    candidateDefinitionId: passing[0]?.id,
    anyDefinitionPassed: passing.length > 0,
    passingDefinitionIds: passing.map((variant) => variant.id),
  },
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

function createAccumulator(id) {
  return {
    id,
    overall: emptyGroup(),
    byTimeBucket: new Map(),
    byEconomyBand: new Map(),
    byPhase: new Map(),
    byActionType: new Map(),
  };
}

function emptyGroup() {
  return { decisions: 0, observed: 0, candidateCounts: [] };
}

function observe(group, observed, candidateCount) {
  group.decisions += 1;
  group.observed += observed ? 1 : 0;
  group.candidateCounts.push(candidateCount);
}

function observeGroup(map, key, observed, candidateCount) {
  const group = map.get(key) ?? emptyGroup();
  observe(group, observed, candidateCount);
  map.set(key, group);
}

function finalizeVariant(accumulator) {
  const overall = finalizeGroup(accumulator.overall);
  const byTimeBucket = finalizeMap(accumulator.byTimeBucket);
  const byEconomyBand = finalizeMap(accumulator.byEconomyBand);
  const byPhase = finalizeMap(accumulator.byPhase);
  const byActionType = finalizeMap(accumulator.byActionType);
  const majorGroups = [...byTimeBucket, ...byEconomyBand, ...byPhase, ...byActionType].filter(
    (group) => group.decisionCount >= majorGroupMinDecisions,
  );
  const lowCoverageMajorGroups = majorGroups
    .filter((group) => group.observedCoverage < minimumMajorCohortCoverage)
    .sort((left, right) => left.observedCoverage - right.observedCoverage || right.decisionCount - left.decisionCount);
  return {
    id: accumulator.id,
    overall,
    byTimeBucket,
    byEconomyBand,
    byPhase,
    byActionType,
    gate: {
      passed:
        overall.observedCoverage >= minimumOverallCoverage &&
        lowCoverageMajorGroups.length === 0,
      lowCoverageMajorGroupCount: lowCoverageMajorGroups.length,
      lowCoverageMajorGroups,
    },
  };
}

function finalizeMap(map) {
  return [...map.entries()]
    .map(([key, group]) => ({ key, ...finalizeGroup(group) }))
    .sort((left, right) => String(left.key).localeCompare(String(right.key), undefined, { numeric: true }));
}

function finalizeGroup(group) {
  return {
    decisionCount: group.decisions,
    observedCoverage: divide(group.observed, group.decisions),
    candidateCount: distribution(group.candidateCounts),
  };
}

function distribution(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0 };
  return {
    count: sorted.length,
    min: sorted[0],
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function quantile(sorted, q) {
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function integer(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
