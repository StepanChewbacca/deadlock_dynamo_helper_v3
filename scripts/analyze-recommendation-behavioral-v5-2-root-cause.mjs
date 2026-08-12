import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const samplePath = required('BEHAVIORAL_SAMPLE_PATH');
const v51EvaluationPath = required('BEHAVIORAL_V51_EVALUATION_PATH');
const v52OutputDirectory = required('BEHAVIORAL_V52_OUTPUT_DIR');
const reportPath = process.env.ROOT_CAUSE_REPORT_PATH?.trim() || '/tmp/recommendation-behavioral-v5-2-root-cause.json';

const rows = [];
const stream = createReadStream(samplePath).pipe(createGunzip());
const input = createInterface({ input: stream, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (row.split === 'FUTURE_TEST') throw new Error('FUTURE_TEST is forbidden in root-cause diagnostics.');
  rows.push(row);
}
if (rows.length === 0) throw new Error('Pinned sample is empty.');

const candidateCounts = [];
const observedRanks = [];
const observedHistoricalProbabilities = [];
const observedGeneratorScores = [];
const observedCostNetWorthRatios = [];
const allCostNetWorthRatios = [];
const actionTypeCounts = new Map();
const observedActionTypeCounts = new Map();
const candidateSizeBins = new Map();
const timeBuckets = new Map();
const economyBands = new Map();
const priorAccumulators = {
  historicalProbability: emptyPrior(),
  generatorScore: emptyPrior(),
  inverseRank: emptyPrior(),
};

for (const row of rows) {
  const candidates = row.candidates;
  const observedIndex = candidates.findIndex((candidate) => candidate.actionKey === row.observedActionKey);
  if (observedIndex < 0) throw new Error(`Observed action missing for ${row.decisionId}.`);
  const observed = candidates[observedIndex];
  const observedRank = Number(observed.rank ?? observedIndex + 1);
  candidateCounts.push(candidates.length);
  observedRanks.push(observedRank);
  observedHistoricalProbabilities.push(number(observed.historicalProbability));
  observedGeneratorScores.push(number(observed.generatorScore));
  if (Number.isFinite(observed.costToNetWorthRatio)) observedCostNetWorthRatios.push(observed.costToNetWorthRatio);

  increment(observedActionTypeCounts, observed.actionType ?? 'UNKNOWN');
  for (const candidate of candidates) {
    increment(actionTypeCounts, candidate.actionType ?? 'UNKNOWN');
    if (Number.isFinite(candidate.costToNetWorthRatio)) allCostNetWorthRatios.push(candidate.costToNetWorthRatio);
  }

  const sizeBin = candidateSizeBin(candidates.length);
  observeGroup(candidateSizeBins, sizeBin, observedRank, observed.historicalProbability, candidates.length);
  const timeBucket = `${Math.floor(number(row.state?.gameTimeS) / 300) * 5}-${Math.floor(number(row.state?.gameTimeS) / 300) * 5 + 5}m`;
  observeGroup(timeBuckets, timeBucket, observedRank, observed.historicalProbability, candidates.length);
  const economy = economyBand(row.state?.netWorth);
  observeGroup(economyBands, economy, observedRank, observed.historicalProbability, candidates.length);

  evaluatePrior(priorAccumulators.historicalProbability, candidates, observedIndex, (candidate) => Math.max(0, number(candidate.historicalProbability)));
  evaluatePrior(priorAccumulators.generatorScore, candidates, observedIndex, (candidate) => Math.max(0, number(candidate.generatorScore)));
  evaluatePrior(priorAccumulators.inverseRank, candidates, observedIndex, (candidate, index) => 1 / Math.max(1, number(candidate.rank) || index + 1));
}

const v51Evaluation = JSON.parse(await readFile(v51EvaluationPath, 'utf8'));
const v52Evaluations = {};
for (const variant of ['a', 'b', 'c']) {
  v52Evaluations[variant.toUpperCase()] = JSON.parse(await readFile(`${v52OutputDirectory}/${variant}/evaluation.json`, 'utf8'));
}

const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V5_2_ROOT_CAUSE_DIAGNOSTIC',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  futureTestEvaluated: false,
  sample: {
    rowCount: rows.length,
    candidateCount: distribution(candidateCounts),
    meanCandidatesPerDecision: mean(candidateCounts),
    fractionCandidateCountGt100: fraction(candidateCounts, (value) => value > 100),
    fractionCandidateCountGt128: fraction(candidateCounts, (value) => value > 128),
    fractionCandidateCountGt200: fraction(candidateCounts, (value) => value > 200),
    observedRank: distribution(observedRanks),
    observedRankCoverage: Object.fromEntries([1, 5, 10, 20, 50, 100, 128, 256].map((limit) => [`le${limit}`, fraction(observedRanks, (value) => value <= limit)])),
    observedHistoricalProbability: distribution(observedHistoricalProbabilities),
    observedHistoricalProbabilityThresholdCoverage: Object.fromEntries([0.005, 0.01, 0.02].map((threshold) => [`ge${threshold}`, fraction(observedHistoricalProbabilities, (value) => value >= threshold)])),
    observedGeneratorScore: distribution(observedGeneratorScores),
    observedCostToNetWorthRatio: distribution(observedCostNetWorthRatios),
    allCandidateCostToNetWorthRatio: distribution(allCostNetWorthRatios),
    candidateActionTypeCounts: sortedObject(actionTypeCounts),
    observedActionTypeCounts: sortedObject(observedActionTypeCounts),
  },
  noTrainingPriors: Object.fromEntries(Object.entries(priorAccumulators).map(([name, acc]) => [name, finalizePrior(acc)])),
  byCandidateSetSize: finalizeGroups(candidateSizeBins),
  byTimeBucket: finalizeGroups(timeBuckets),
  byEconomyBand: finalizeGroups(economyBands),
  v51MajorLowSupportGroups: lowestGroups(v51Evaluation?.metrics?.groups ?? [], 30),
  v52MajorLowSupportGroups: Object.fromEntries(Object.entries(v52Evaluations).map(([variant, evaluation]) => [variant, lowestGroups(evaluation?.metrics?.groups ?? [], 30)])),
  v52ReleaseGates: Object.fromEntries(Object.entries(v52Evaluations).map(([variant, evaluation]) => [variant, evaluation?.releaseGate])),
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

function emptyPrior() {
  return { decisions: 0, supported: 0, top1: 0, loss: 0, observedProbability: 0, zeroMassDecisions: 0 };
}

function evaluatePrior(acc, candidates, observedIndex, weightFn) {
  const weights = candidates.map((candidate, index) => Math.max(0, number(weightFn(candidate, index))));
  let total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) {
    acc.zeroMassDecisions += 1;
    total = candidates.length;
    weights.fill(1);
  }
  const probabilities = weights.map((value) => value / total);
  const observedProbability = probabilities[observedIndex];
  let topIndex = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    if (probabilities[index] > probabilities[topIndex]) topIndex = index;
  }
  acc.decisions += 1;
  acc.supported += observedProbability >= 0.01 ? 1 : 0;
  acc.top1 += topIndex === observedIndex ? 1 : 0;
  acc.loss += -Math.log(Math.max(observedProbability, 1e-15));
  acc.observedProbability += observedProbability;
}

function finalizePrior(acc) {
  return {
    decisionCount: acc.decisions,
    supportCoverageAt001: acc.supported / acc.decisions,
    top1Rate: acc.top1 / acc.decisions,
    rawLogLoss: acc.loss / acc.decisions,
    meanObservedProbability: acc.observedProbability / acc.decisions,
    zeroMassDecisionRate: acc.zeroMassDecisions / acc.decisions,
  };
}

function observeGroup(map, key, observedRank, historicalProbability, candidateCount) {
  const group = map.get(key) ?? { decisions: 0, candidateCountSum: 0, observedRankSum: 0, observedHistoricalProbabilitySum: 0, observedRankLe20: 0, observedRankLe100: 0, historicalProbabilityGe001: 0 };
  group.decisions += 1;
  group.candidateCountSum += candidateCount;
  group.observedRankSum += number(observedRank);
  group.observedHistoricalProbabilitySum += number(historicalProbability);
  group.observedRankLe20 += observedRank <= 20 ? 1 : 0;
  group.observedRankLe100 += observedRank <= 100 ? 1 : 0;
  group.historicalProbabilityGe001 += number(historicalProbability) >= 0.01 ? 1 : 0;
  map.set(key, group);
}

function finalizeGroups(map) {
  return [...map.entries()].map(([key, value]) => ({
    key,
    decisionCount: value.decisions,
    meanCandidateCount: value.candidateCountSum / value.decisions,
    meanObservedRank: value.observedRankSum / value.decisions,
    observedRankLe20Rate: value.observedRankLe20 / value.decisions,
    observedRankLe100Rate: value.observedRankLe100 / value.decisions,
    meanObservedHistoricalProbability: value.observedHistoricalProbabilitySum / value.decisions,
    observedHistoricalProbabilityGe001Rate: value.historicalProbabilityGe001 / value.decisions,
  })).sort((left, right) => String(left.key).localeCompare(String(right.key), undefined, { numeric: true }));
}

function lowestGroups(groups, limit) {
  return groups.filter((group) => group.major === true).sort((left, right) => number(left.supportCoverage) - number(right.supportCoverage) || number(right.decisionCount) - number(left.decisionCount)).slice(0, limit);
}

function candidateSizeBin(value) {
  if (value <= 50) return 'LE_50';
  if (value <= 100) return '51_100';
  if (value <= 150) return '101_150';
  if (value <= 200) return '151_200';
  return 'GT_200';
}

function economyBand(netWorth) {
  const value = number(netWorth);
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if (value < 5000) return 'LT_5000';
  if (value < 10000) return '5000_9999';
  if (value < 15000) return '10000_14999';
  if (value < 20000) return '15000_19999';
  return 'GE_20000';
}

function distribution(values) {
  const finite = values.map(number).filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return { count: 0 };
  return {
    count: finite.length,
    min: finite[0],
    p10: quantile(finite, 0.1),
    p25: quantile(finite, 0.25),
    p50: quantile(finite, 0.5),
    p75: quantile(finite, 0.75),
    p90: quantile(finite, 0.9),
    p95: quantile(finite, 0.95),
    p99: quantile(finite, 0.99),
    max: finite[finite.length - 1],
    mean: mean(finite),
  };
}

function quantile(sorted, q) {
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + number(value), 0) / values.length;
}

function fraction(values, predicate) {
  return values.length === 0 ? 0 : values.filter(predicate).length / values.length;
}

function increment(map, key) {
  map.set(String(key), (map.get(String(key)) ?? 0) + 1);
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
