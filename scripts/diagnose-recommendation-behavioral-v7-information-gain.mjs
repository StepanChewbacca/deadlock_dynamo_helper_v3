import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const datasetPath = required('BEHAVIORAL_V7_DATASET_PATH');
const outputPath = required('BEHAVIORAL_V7_INFORMATION_GAIN_REPORT_PATH');
const supportProbability = 0.01;
const rows = [[], []];
let futureTestRowCount = 0;
let tuningRowCount = 0;

const input = createInterface({ input: openDataset(datasetPath), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (row?.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1') {
    throw new Error('Unsupported Dataset V7 row.');
  }
  if (row.split === 'FUTURE_TEST') {
    futureTestRowCount += 1;
    continue;
  }
  if (row.split === 'TUNING') {
    tuningRowCount += 1;
    continue;
  }
  if (row.split !== 'TRAIN' || row.eligibility?.behavioralModel !== true) continue;
  const actionKeys = row.choiceSet?.behavioralChoiceSetActionKeys ?? [];
  if (actionKeys.length < 2 || !actionKeys.includes(row.observedActionKey)) continue;
  rows[fnv1a32(String(row.matchId)) & 1].push(row);
}

if (futureTestRowCount !== 0) {
  throw new Error(`FUTURE_TEST must not be present in information-gain input, got ${futureTestRowCount}.`);
}
if (rows[0].length < 1000 || rows[1].length < 1000) {
  throw new Error('Both TRAIN MATCH partitions require at least 1000 decisions.');
}

const directions = [
  evaluateDirection(rows[0], rows[1], 'P0_TO_P1'),
  evaluateDirection(rows[1], rows[0], 'P1_TO_P0'),
];
const aggregate = combine(directions);
const supportGain = aggregate.enriched.supportCoverage - aggregate.baseline.supportCoverage;
const rawLogLossGain = aggregate.baseline.rawLogLoss - aggregate.enriched.rawLogLoss;
const lateGain = groupSupport(aggregate.enriched.groups, 'PHASE:LATE') - groupSupport(aggregate.baseline.groups, 'PHASE:LATE');
const economyGain = groupSupport(aggregate.enriched.groups, 'ECONOMY:GE_20000') - groupSupport(aggregate.baseline.groups, 'ECONOMY:GE_20000');
const directionChecks = directions.map((direction) => ({
  id: direction.id,
  supportGain: direction.enriched.supportCoverage - direction.baseline.supportCoverage,
  rawLogLossGain: direction.baseline.rawLogLoss - direction.enriched.rawLogLoss,
  passed:
    direction.enriched.supportCoverage > direction.baseline.supportCoverage &&
    direction.enriched.rawLogLoss <= direction.baseline.rawLogLoss + 0.01,
}));
const gates = {
  futureTestExcluded: futureTestRowCount === 0,
  tuningUntouched: tuningRowCount >= 0,
  sameChoiceSetUsedForBaselineAndEnriched: true,
  supportGainAtLeast001: supportGain >= 0.01,
  logLossOrTailGain:
    rawLogLossGain >= 0.03 || (lateGain >= 0.02 && economyGain >= 0.02),
  bothMatchDirectionsImprove: directionChecks.every((check) => check.passed),
};
const stageEGatePassed = Object.values(gates).every(Boolean);
const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_INFORMATION_GAIN_DIAGNOSTIC',
  executorVersion: 'MATCH_CROSSFIT_CONDITIONAL_PRIOR_GAIN_1',
  generatedAt: new Date().toISOString(),
  trainingArtifactEligible: false,
  behavioralModelTrainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  tuningUsedForDiagnostic: false,
  source: {
    datasetPath,
    partitionDecisionCounts: rows.map((partition) => partition.length),
    tuningRowCountUntouched: tuningRowCount,
    futureTestRowCount,
  },
  contract: {
    baselineFeatures: 'V6_PREDECISION_STATE_BUCKETS',
    enrichedFeatures: 'V6_PREDECISION_STATE_BUCKETS_PLUS_V7_OBSERVABILITY',
    identicalBehavioralChoiceSet: true,
    observedActionMaySelectFeatures: false,
    matchCrossFit: true,
  },
  directions,
  aggregate,
  gains: { supportGain, rawLogLossGain, lateGain, highEconomyGain: economyGain },
  directionChecks,
  gates,
  stageEGatePassed,
  nextStep: stageEGatePassed
    ? 'ALLOW_BOUNDED_BEHAVIORAL_V7_SCREEN'
    : 'COLLECT_NEW_OBSERVABILITY_TELEMETRY',
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ stageEGatePassed, gains: report.gains, gates }, null, 2));

function evaluateDirection(trainingRows, evaluationRows, id) {
  const baselineCounts = buildCounts(trainingRows, false);
  const enrichedCounts = buildCounts(trainingRows, true);
  return {
    id,
    trainingDecisionCount: trainingRows.length,
    evaluationDecisionCount: evaluationRows.length,
    baseline: evaluate(evaluationRows, baselineCounts, false),
    enriched: evaluate(evaluationRows, enrichedCounts, true),
  };
}
function buildCounts(sourceRows, enriched) {
  const groups = new Map();
  for (const row of sourceRows) {
    const key = stateKey(row, enriched);
    const actions = groups.get(key) ?? new Map();
    actions.set(row.observedActionKey, (actions.get(row.observedActionKey) ?? 0) + 1);
    groups.set(key, actions);
  }
  return groups;
}
function evaluate(sourceRows, counts, enriched) {
  const metric = emptyMetric();
  for (const row of sourceRows) {
    const actionKeys = row.choiceSet.behavioralChoiceSetActionKeys;
    const group = counts.get(stateKey(row, enriched));
    const prediction = probabilities(actionKeys, group);
    const observedProbability = prediction.get(row.observedActionKey) ?? 0;
    let topActionKey = actionKeys[0];
    for (const actionKey of actionKeys.slice(1)) {
      if ((prediction.get(actionKey) ?? 0) > (prediction.get(topActionKey) ?? 0)) topActionKey = actionKey;
    }
    observe(metric, row, observedProbability, topActionKey === row.observedActionKey);
  }
  return finalize(metric);
}
function probabilities(actionKeys, counts) {
  const alpha = 0.25;
  const totalObserved = counts ? [...counts.values()].reduce((sum, value) => sum + value, 0) : 0;
  const denominator = totalObserved + alpha * actionKeys.length;
  return new Map(
    actionKeys.map((actionKey) => [
      actionKey,
      ((counts?.get(actionKey) ?? 0) + alpha) / Math.max(denominator, alpha * actionKeys.length),
    ]),
  );
}
function stateKey(row, enriched) {
  const state = row.state;
  const base = [
    `H=${state.heroId}`,
    `P=${state.phase}`,
    `T=${Math.floor(Number(state.gameTimeS) / 300)}`,
    `E=${economyBand(Number(state.netWorth))}`,
    `I=${Math.min(12, state.inventoryItemCounts?.reduce((sum, item) => sum + Number(item.count), 0) ?? 0)}`,
    `L=${state.previousActionKeys?.slice(-1)[0] ?? 'NONE'}`,
  ];
  if (!enriched) return base.join('|');
  const observations = (row.observability ?? [])
    .map((observation) => `${observation.fieldName}=${observation.missing ? 'MISSING' : bucket(observation.value)}`)
    .sort();
  return [...base, ...observations].join('|');
}
function bucket(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NONFINITE';
    const width = Math.abs(value) >= 10000 ? 5000 : Math.abs(value) >= 1000 ? 500 : Math.abs(value) >= 100 ? 50 : 5;
    return String(Math.floor(value / width) * width);
  }
  if (Array.isArray(value)) return `ARRAY:${value.length}`;
  return String(value);
}
function emptyMetric() {
  return { decisions: 0, support: 0, top1: 0, loss: 0, groups: new Map() };
}
function observe(metric, row, probability, top1) {
  metric.decisions += 1;
  metric.support += probability >= supportProbability ? 1 : 0;
  metric.top1 += top1 ? 1 : 0;
  metric.loss += -Math.log(Math.max(probability, 1e-15));
  for (const key of groupKeys(row)) {
    const group = metric.groups.get(key) ?? { decisions: 0, support: 0, loss: 0 };
    group.decisions += 1;
    group.support += probability >= supportProbability ? 1 : 0;
    group.loss += -Math.log(Math.max(probability, 1e-15));
    metric.groups.set(key, group);
  }
}
function finalize(metric) {
  return {
    decisionCount: metric.decisions,
    supportCoverage: ratio(metric.support, metric.decisions),
    rawLogLoss: ratio(metric.loss, metric.decisions),
    top1Rate: ratio(metric.top1, metric.decisions),
    groups: [...metric.groups.entries()].map(([key, value]) => ({
      key,
      decisionCount: value.decisions,
      supportCoverage: ratio(value.support, value.decisions),
      rawLogLoss: ratio(value.loss, value.decisions),
    })).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
  };
}
function combine(directions) {
  return {
    baseline: combineMetrics(directions.map((direction) => direction.baseline)),
    enriched: combineMetrics(directions.map((direction) => direction.enriched)),
  };
}
function combineMetrics(metrics) {
  const total = metrics.reduce((sum, metric) => sum + metric.decisionCount, 0);
  const groupMap = new Map();
  for (const metric of metrics) {
    for (const group of metric.groups) {
      const value = groupMap.get(group.key) ?? { decisions: 0, supportSum: 0, lossSum: 0 };
      value.decisions += group.decisionCount;
      value.supportSum += group.supportCoverage * group.decisionCount;
      value.lossSum += group.rawLogLoss * group.decisionCount;
      groupMap.set(group.key, value);
    }
  }
  return {
    decisionCount: total,
    supportCoverage: weighted(metrics, 'supportCoverage'),
    rawLogLoss: weighted(metrics, 'rawLogLoss'),
    top1Rate: weighted(metrics, 'top1Rate'),
    groups: [...groupMap.entries()].map(([key, value]) => ({
      key,
      decisionCount: value.decisions,
      supportCoverage: ratio(value.supportSum, value.decisions),
      rawLogLoss: ratio(value.lossSum, value.decisions),
    })),
  };
}
function weighted(metrics, field) {
  const total = metrics.reduce((sum, metric) => sum + metric.decisionCount, 0);
  return ratio(metrics.reduce((sum, metric) => sum + metric[field] * metric.decisionCount, 0), total);
}
function groupKeys(row) {
  return [`PHASE:${row.state.phase}`, `ECONOMY:${economyBand(Number(row.state.netWorth))}`];
}
function groupSupport(groups, key) {
  return groups.find((group) => group.key === key)?.supportCoverage ?? 0;
}
function economyBand(value) {
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if (value < 5000) return 'LT_5000';
  if (value < 10000) return '5000_9999';
  if (value < 15000) return '10000_14999';
  if (value < 20000) return '15000_19999';
  return 'GE_20000';
}
function openDataset(path) {
  const stream = createReadStream(path);
  return path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
}
function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
