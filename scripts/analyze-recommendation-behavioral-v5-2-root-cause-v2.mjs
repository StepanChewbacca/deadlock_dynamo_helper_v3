import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const samplePath = required('BEHAVIORAL_SAMPLE_PATH');
const v52OutputDirectory = required('BEHAVIORAL_V52_OUTPUT_DIR');
const reportPath = process.env.ROOT_CAUSE_REPORT_PATH?.trim() || '/tmp/recommendation-behavioral-v5-2-root-cause.json';

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
let rowCount = 0;

const input = createInterface({
  input: createReadStream(samplePath).pipe(createGunzip()),
  crlfDelay: Infinity,
});
for await (const line of input) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (row.split === 'FUTURE_TEST') throw new Error('FUTURE_TEST is forbidden in root-cause diagnostics.');
  const candidates = row.candidates;
  const observedIndex = candidates.findIndex((candidate) => candidate.actionKey === row.observedActionKey);
  if (observedIndex < 0) throw new Error(`Observed action missing for ${row.decisionId}.`);
  const observed = candidates[observedIndex];
  const observedRank = finite(observed.rank, observedIndex + 1);

  rowCount += 1;
  candidateCounts.push(candidates.length);
  observedRanks.push(observedRank);
  observedHistoricalProbabilities.push(finite(observed.historicalProbability));
  observedGeneratorScores.push(finite(observed.generatorScore));
  if (Number.isFinite(Number(observed.costToNetWorthRatio))) observedCostNetWorthRatios.push(Number(observed.costToNetWorthRatio));

  increment(observedActionTypeCounts, observed.actionType ?? 'UNKNOWN');
  for (const candidate of candidates) {
    increment(actionTypeCounts, candidate.actionType ?? 'UNKNOWN');
    if (Number.isFinite(Number(candidate.costToNetWorthRatio))) allCostNetWorthRatios.push(Number(candidate.costToNetWorthRatio));
  }

  observeGroup(candidateSizeBins, candidateSizeBin(candidates.length), observedRank, observed.historicalProbability, candidates.length);
  const fiveMinute = Math.floor(finite(row.state?.gameTimeS) / 300) * 5;
  observeGroup(timeBuckets, `${fiveMinute}-${fiveMinute + 5}m`, observedRank, observed.historicalProbability, candidates.length);
  observeGroup(economyBands, economyBand(row.state?.netWorth), observedRank, observed.historicalProbability, candidates.length);

  evaluatePrior(priorAccumulators.historicalProbability, candidates, observedIndex, (candidate) => Math.max(0, finite(candidate.historicalProbability)));
  evaluatePrior(priorAccumulators.generatorScore, candidates, observedIndex, (candidate) => Math.max(0, finite(candidate.generatorScore)));
  evaluatePrior(priorAccumulators.inverseRank, candidates, observedIndex, (candidate, index) => 1 / Math.max(1, finite(candidate.rank, index + 1)));
}
if (rowCount === 0) throw new Error('Pinned sample is empty.');

const v52Evaluations = {};
for (const variant of ['a', 'b', 'c']) {
  v52Evaluations[variant.toUpperCase()] = JSON.parse(await readFile(`${v52OutputDirectory}/${variant}/evaluation.json`, 'utf8'));
}

const report = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_BEHAVIORAL_V5_2_ROOT_CAUSE_DIAGNOSTIC',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  futureTestEvaluated: false,
  sample: {
    rowCount,
    candidateCount: distribution(candidateCounts),
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
  v52MajorLowSupportGroups: Object.fromEntries(Object.entries(v52Evaluations).map(([variant, evaluation]) => [variant, lowestGroups(evaluation?.metrics?.groups ?? [], 30)])),
  v52ReleaseGates: Object.fromEntries(Object.entries(v52Evaluations).map(([variant, evaluation]) => [variant, evaluation?.releaseGate])),
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

function emptyPrior() {
  return { decisions: 0, supported: 0, top1: 0, loss: 0, observedProbability: 0, zeroMassDecisions: 0 };
}
function evaluatePrior(acc, candidates, observedIndex, weightFn) {
  const weights = candidates.map((candidate, index) => Math.max(0, finite(weightFn(candidate, index))));
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
  group.observedRankSum += finite(observedRank);
  group.observedHistoricalProbabilitySum += finite(historicalProbability);
  group.observedRankLe20 += observedRank <= 20 ? 1 : 0;
  group.observedRankLe100 += observedRank <= 100 ? 1 : 0;
  group.historicalProbabilityGe001 += finite(historicalProbability) >= 0.01 ? 1 : 0;
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
  return groups.filter((group) => group.major === true).sort((left, right) => finite(left.supportCoverage) - finite(right.supportCoverage) || finite(right.decisionCount) - finite(left.decisionCount)).slice(0, limit);
}
function candidateSizeBin(value) {
  if (value <= 50) return 'LE_50';
  if (value <= 100) return '51_100';
  if (value <= 150) return '101_150';
  if (value <= 200) return '151_200';
  return 'GT_200';
}
function economyBand(netWorth) {
  const value = Number(netWorth);
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if (value < 5000) return 'LT_5000';
  if (value < 10000) return '5000_9999';
  if (value < 15000) return '10000_14999';
  if (value < 20000) return '15000_19999';
  return 'GE_20000';
}
function distribution(values) {
  const sorted = values.map((value) => Number(value)).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0 };
  return { count: sorted.length, min: sorted[0], p10: quantile(sorted, 0.1), p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.9), p95: quantile(sorted, 0.95), p99: quantile(sorted, 0.99), max: sorted[sorted.length - 1], mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length };
}
function quantile(sorted, q) {
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
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
function finite(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
