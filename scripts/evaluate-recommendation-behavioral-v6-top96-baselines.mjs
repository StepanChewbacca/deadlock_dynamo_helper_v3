import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const samplePath = required('BEHAVIORAL_V6_SAMPLE_PATH');
const choiceSetReportPath = required('BEHAVIORAL_V6_CHOICE_SET_REPORT_PATH');
const reportPath = required('BEHAVIORAL_V6_BASELINE_REPORT_PATH');
const expectedSampleSha256 = requiredSha('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');
const choiceSetDefinition = 'MERGED_TOP_96';
const choiceSetLimit = 96;
const supportProbability = 0.01;
const propensityFloors = [0.005, 0.01, 0.02];
const majorGroupMinDecisions = 100;

const sampleSha256 = await hashFile(samplePath);
assertEqual(sampleSha256, expectedSampleSha256, 'Pinned MATCH sample SHA-256');
const choiceSetReport = JSON.parse(await readFile(choiceSetReportPath, 'utf8'));
validateChoiceSetReport(choiceSetReport);
const selectedChoiceSet = choiceSetReport.variants.find(
  (variant) => variant.id === choiceSetDefinition,
);
if (!selectedChoiceSet?.gate?.passed) {
  throw new Error(`${choiceSetDefinition} did not pass the frozen choice-set gate.`);
}

const pinnedRows = await loadPinnedSample(samplePath);
const futureTestRowCount = pinnedRows.filter((row) => row.split === 'FUTURE_TEST').length;
if (futureTestRowCount !== 0) {
  throw new Error(`Pinned Behavioral V6 sample unexpectedly contains ${futureTestRowCount} FUTURE_TEST rows.`);
}
const selectionRows = pinnedRows.filter(
  (row) => row.split === 'TRAIN' || row.split === 'TUNING',
);
const candidateCoveredRows = selectionRows.filter(observedInsideTop96);
const candidateCoverage = divide(candidateCoveredRows.length, selectionRows.length);
if (candidateCoverage < 0.99) {
  throw new Error(`Behavioral V6 ${choiceSetDefinition} coverage ${candidateCoverage} is below 0.99.`);
}
const evaluationRows = selectionRows
  .filter((row) => row.eligibility?.behavioralModel === true)
  .filter(observedInsideTop96)
  .map(applyTop96ChoiceSet)
  .filter((row) => row.candidates.length >= 2);
if (evaluationRows.length === 0) {
  throw new Error('Behavioral V6 baseline evaluation has no eligible rows.');
}

const definitions = [
  {
    id: 'HISTORICAL_PRIOR',
    probability: (candidate) => nonNegative(candidate.historicalProbability),
  },
  {
    id: 'GENERATOR_PRIOR',
    probability: (candidate) => nonNegative(candidate.generatorScore),
  },
  {
    id: 'INVERSE_RANK',
    probability: (candidate) => 1 / Math.max(1, Number(candidate.rank) || 1),
  },
];

const results = definitions.map((definition) => evaluateDefinition(definition));
const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_TOP96_BASELINE_EVALUATION',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  source: {
    sampleSha256,
    pinnedSampleRowCount: pinnedRows.length,
    selectionRowCount: selectionRows.length,
    evaluationRowCount: evaluationRows.length,
    futureTestRowCount,
  },
  choiceSet: {
    definition: choiceSetDefinition,
    maximumCandidates: choiceSetLimit,
    candidateCoverage,
    frozenGateOverallCoverage: selectedChoiceSet.overall.observedCoverage,
    frozenGateLowCoverageMajorGroupCount: selectedChoiceSet.gate.lowCoverageMajorGroupCount,
    observedActionInjected: false,
    selectedAfterObservedAction: false,
  },
  metrics: {
    supportProbability,
    propensityFloors,
    majorGroupMinDecisions,
  },
  results,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

function evaluateDefinition(definition) {
  const accumulator = createAccumulator();
  for (const row of evaluationRows) {
    const probabilities = normalizeWeights(
      row.candidates.map((candidate) => definition.probability(candidate)),
    );
    const observedIndex = row.candidates.findIndex(
      (candidate) => candidate.actionKey === row.observedActionKey,
    );
    if (observedIndex < 0) {
      throw new Error('Observed action escaped the frozen top96 choice set.');
    }
    const observedProbability = probabilities[observedIndex];
    const topIndex = bestIndex(probabilities, row.candidates);
    const supported = observedProbability >= supportProbability;
    const top1 = topIndex === observedIndex;
    observe(accumulator.selection, row, probabilities, observedProbability, supported, top1);
    const split = getOrCreate(accumulator.bySplit, row.split, emptyMetricGroup);
    observe(split, row, probabilities, observedProbability, supported, top1);
    const observedCandidate = row.candidates[observedIndex];
    const groupKeys = [
      `HERO:${row.state.heroId}`,
      `PHASE:${row.state.phase}`,
      `TIME:${timeBucket(row.state.gameTimeS)}`,
      `ECONOMY:${economyBand(row.state.netWorth)}`,
      `ACTION:${String(row.observedActionKey).split(':')[0]}`,
      `TIER:${observedCandidate?.tier ?? 'UNKNOWN'}`,
    ];
    for (const key of groupKeys) {
      const group = getOrCreate(accumulator.groups, key, emptyMetricGroup);
      observe(group, row, probabilities, observedProbability, supported, top1);
    }
    for (const floor of propensityFloors) {
      accumulator.floorLossSums.set(
        floor,
        accumulator.floorLossSums.get(floor) - Math.log(Math.max(observedProbability, floor)),
      );
    }
  }
  const metrics = finalizeAccumulator(accumulator);
  const majorLowSupportGroups = metrics.groups.filter(
    (group) => group.major && group.supportCoverage < 0.75,
  );
  return {
    id: definition.id,
    supportCoverage: metrics.selection.supportCoverage,
    rawLogLoss: metrics.selection.rawLogLoss,
    top1Rate: metrics.selection.top1Rate,
    meanObservedRawProbability: metrics.selection.meanObservedRawProbability,
    minimumObservedRawProbability: metrics.selection.minimumObservedRawProbability,
    floorSensitivityDelta: metrics.probabilityFloorSensitivity.maximumLogLossDelta,
    extremeCandidateProbabilityRate: metrics.selection.extremeCandidateProbabilityRate,
    majorLowSupportGroupCount: majorLowSupportGroups.length,
    majorLowSupportGroups,
    bySplit: metrics.bySplit,
  };
}

function createAccumulator() {
  return {
    selection: emptyMetricGroup(),
    bySplit: new Map(),
    groups: new Map(),
    floorLossSums: new Map(propensityFloors.map((floor) => [floor, 0])),
  };
}

function emptyMetricGroup() {
  return {
    decisions: 0,
    supported: 0,
    top1: 0,
    rawLogLoss: 0,
    observedProbability: 0,
    minimumObservedProbability: 1,
    extremeCandidates: 0,
    candidateCount: 0,
  };
}

function observe(group, row, probabilities, observedProbability, supported, top1) {
  void row;
  group.decisions += 1;
  group.supported += supported ? 1 : 0;
  group.top1 += top1 ? 1 : 0;
  group.rawLogLoss += -Math.log(Math.max(observedProbability, 1e-15));
  group.observedProbability += observedProbability;
  group.minimumObservedProbability = Math.min(group.minimumObservedProbability, observedProbability);
  for (const probability of probabilities) {
    group.candidateCount += 1;
    if (probability <= 1e-8 || probability >= 1 - 1e-8) {
      group.extremeCandidates += 1;
    }
  }
}

function finalizeAccumulator(accumulator) {
  const selection = finalizeMetricGroup(accumulator.selection);
  const bySplit = Object.fromEntries(
    [...accumulator.bySplit.entries()].map(([key, value]) => [key, finalizeMetricGroup(value)]),
  );
  const groups = [...accumulator.groups.entries()]
    .map(([key, value]) => ({
      key,
      major: value.decisions >= majorGroupMinDecisions,
      ...finalizeMetricGroup(value),
    }))
    .sort((left, right) => left.key.localeCompare(right.key, undefined, { numeric: true }));
  const floors = propensityFloors.map((floor) => {
    const logLoss = divide(accumulator.floorLossSums.get(floor), accumulator.selection.decisions);
    return {
      floor,
      logLoss,
      logLossDeltaFromRaw: Math.abs(selection.rawLogLoss - logLoss),
    };
  });
  return {
    selection,
    bySplit,
    groups,
    probabilityFloorSensitivity: {
      floors,
      maximumLogLossDelta: Math.max(...floors.map((value) => value.logLossDeltaFromRaw)),
    },
  };
}

function finalizeMetricGroup(group) {
  return {
    decisionCount: group.decisions,
    supportCoverage: divide(group.supported, group.decisions),
    rawLogLoss: divide(group.rawLogLoss, group.decisions),
    top1Rate: divide(group.top1, group.decisions),
    meanObservedRawProbability: divide(group.observedProbability, group.decisions),
    minimumObservedRawProbability: group.decisions > 0 ? group.minimumObservedProbability : 0,
    extremeCandidateProbabilityRate: divide(group.extremeCandidates, group.candidateCount),
  };
}

function normalizeWeights(weights) {
  const sanitized = weights.map(nonNegative);
  const total = sanitized.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return sanitized.map(() => 1 / sanitized.length);
  }
  return sanitized.map((value) => value / total);
}

function bestIndex(probabilities, candidates) {
  let best = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    if (
      probabilities[index] > probabilities[best] ||
      (probabilities[index] === probabilities[best] &&
        String(candidates[index].actionKey).localeCompare(String(candidates[best].actionKey)) < 0)
    ) {
      best = index;
    }
  }
  return best;
}

function observedInsideTop96(row) {
  const index = row.candidates.findIndex(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  return index >= 0 && index < choiceSetLimit;
}

function applyTop96ChoiceSet(row) {
  return {
    ...row,
    candidates: row.candidates.slice(0, choiceSetLimit).map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    })),
  };
}

function validateChoiceSetReport(report) {
  if (
    report.schemaVersion !== 1 ||
    report.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_CANDIDATE_EVALUATION' ||
    report.trainingPerformed !== false ||
    report.valueTrainingPerformed !== false ||
    report.futureTestEvaluated !== false ||
    report.source?.futureTestRowCount !== 0 ||
    report.recommendation?.candidateDefinitionId !== choiceSetDefinition
  ) {
    throw new Error('Behavioral V6 frozen choice-set report is not eligible for baseline evaluation.');
  }
}

async function loadPinnedSample(path) {
  const rows = [];
  const input = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

async function hashFile(path) {
  const hash = createHash('sha256');
  const input = createReadStream(path);
  for await (const chunk of input) hash.update(chunk);
  return hash.digest('hex');
}

function getOrCreate(map, key, create) {
  if (!map.has(key)) map.set(key, create());
  return map.get(key);
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function timeBucket(gameTimeS) {
  const start = Math.floor(Math.max(0, Number(gameTimeS) || 0) / 300) * 5;
  return `${start}-${start + 5}m`;
}

function economyBand(netWorth) {
  const value = Number(netWorth);
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if (value < 5_000) return 'LT_5000';
  if (value < 10_000) return '5000_9999';
  if (value < 15_000) return '10000_14999';
  if (value < 20_000) return '15000_19999';
  return 'GE_20000';
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredSha(name) {
  const value = required(name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a SHA-256 value.`);
  return value;
}

function assertEqual(actual, expected, name) {
  if (actual !== expected) {
    throw new Error(`${name} mismatch: expected ${expected}, received ${actual}.`);
  }
}
