import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const compactPath = required('BEHAVIORAL_V7_COMPACT_ROWS_PATH');
const stageDPath = required('BEHAVIORAL_V7_STAGE_D_PATH');
const outputPath = required('BEHAVIORAL_V7_INFORMATION_GAIN_REPORT_PATH');
const supportProbability = 0.01;
const stageD = JSON.parse(await readFile(stageDPath, 'utf8'));
if (
  stageD?.operation !== 'RECOMMENDATION_BEHAVIORAL_V7_FEASIBLE_CHOICE_SET_AUDIT' ||
  stageD?.stageDGatePassed !== true ||
  stageD?.futureTestEvaluated !== false
) {
  throw new Error('Stage D does not permit V7 information-gain evaluation.');
}

const partitions = [[], []];
let tuningRowCount = 0;
let futureTestRowCount = 0;
const input = createInterface({ input: createReadStream(compactPath), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (row.split === 'FUTURE_TEST') {
    futureTestRowCount += 1;
    continue;
  }
  if (row.split === 'TUNING') {
    tuningRowCount += 1;
    continue;
  }
  if (row.split !== 'TRAIN' || row.eligibility?.behavioralModel !== true) continue;
  if (
    !Array.isArray(row.behavioralChoiceSetActionKeys) ||
    row.behavioralChoiceSetActionKeys.length < 2 ||
    !row.behavioralChoiceSetActionKeys.includes(row.observedActionKey)
  ) {
    continue;
  }
  partitions[fnv1a32(String(row.matchId)) & 1].push(row);
}
if (futureTestRowCount !== 0) {
  throw new Error(`Compact V7 input contains FUTURE_TEST rows: ${futureTestRowCount}.`);
}
if (partitions.some((rows) => rows.length < 1000)) {
  throw new Error('Both TRAIN MATCH partitions require at least 1000 decisions.');
}

const directions = [
  evaluateDirection(partitions[0], partitions[1], 'P0_TO_P1'),
  evaluateDirection(partitions[1], partitions[0], 'P1_TO_P0'),
];
const aggregate = combine(directions);
const gains = {
  supportGain:
    aggregate.enriched.supportCoverage - aggregate.baseline.supportCoverage,
  rawLogLossGain:
    aggregate.baseline.rawLogLoss - aggregate.enriched.rawLogLoss,
  lateGain:
    groupSupport(aggregate.enriched.groups, 'PHASE:LATE') -
    groupSupport(aggregate.baseline.groups, 'PHASE:LATE'),
  highEconomyGain:
    groupSupport(aggregate.enriched.groups, 'ECONOMY:GE_20000') -
    groupSupport(aggregate.baseline.groups, 'ECONOMY:GE_20000'),
};
const directionChecks = directions.map((direction) => ({
  id: direction.id,
  supportGain:
    direction.enriched.supportCoverage - direction.baseline.supportCoverage,
  rawLogLossGain:
    direction.baseline.rawLogLoss - direction.enriched.rawLogLoss,
  passed:
    direction.enriched.supportCoverage > direction.baseline.supportCoverage &&
    direction.enriched.rawLogLoss <= direction.baseline.rawLogLoss + 0.01,
}));
const gates = {
  stageDPassed: true,
  futureTestExcluded: futureTestRowCount === 0,
  tuningUntouched: tuningRowCount > 0,
  sameChoiceSetUsedForBaselineAndEnriched: true,
  supportGainAtLeast001: gains.supportGain >= 0.01,
  logLossOrTailGain:
    gains.rawLogLossGain >= 0.03 ||
    (gains.lateGain >= 0.02 && gains.highEconomyGain >= 0.02),
  bothMatchDirectionsImprove: directionChecks.every((check) => check.passed),
};
const stageEGatePassed = Object.values(gates).every(Boolean);
const report = {
  schemaVersion: 3,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_INFORMATION_GAIN_DIAGNOSTIC',
  executorVersion: 'COMPACT_MATCH_CROSSFIT_CONDITIONAL_PRIOR_GAIN_3',
  generatedAt: new Date().toISOString(),
  trainingArtifactEligible: false,
  behavioralModelTrainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  tuningUsedForDiagnostic: false,
  source: {
    compactPath,
    stageDPath,
    partitionDecisionCounts: partitions.map((rows) => rows.length),
    tuningRowCountUntouched: tuningRowCount,
    futureTestRowCount,
  },
  contract: {
    baselineFeatures: 'V6_PREDECISION_STATE_BUCKETS',
    enrichedFeatures: 'V6_STATE_PLUS_COMPACT_V7_OBSERVABILITY',
    identicalBehavioralChoiceSet: true,
    observedActionMaySelectFeatures: false,
    matchCrossFit: true,
    tuningUsedForFeatureSelection: false,
  },
  directions,
  aggregate,
  gains,
  directionChecks,
  gates,
  stageEGatePassed,
  nextStep: stageEGatePassed
    ? 'ALLOW_BOUNDED_BEHAVIORAL_V7_SCREEN'
    : 'COLLECT_NEW_OBSERVABILITY_TELEMETRY',
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ stageEGatePassed, gains, gates }, null, 2));

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
function buildCounts(rows, enriched) {
  const groups = new Map();
  for (const row of rows) {
    const key = stateKey(row, enriched);
    const counts = groups.get(key) ?? new Map();
    counts.set(row.observedActionKey, (counts.get(row.observedActionKey) ?? 0) + 1);
    groups.set(key, counts);
  }
  return groups;
}
function evaluate(rows, counts, enriched) {
  const metric = emptyMetric();
  for (const row of rows) {
    const actionKeys = row.behavioralChoiceSetActionKeys;
    const prediction = probabilities(actionKeys, counts.get(stateKey(row, enriched)));
    const observedProbability = prediction.get(row.observedActionKey) ?? 0;
    let topActionKey = actionKeys[0];
    for (const actionKey of actionKeys.slice(1)) {
      if ((prediction.get(actionKey) ?? 0) > (prediction.get(topActionKey) ?? 0)) {
        topActionKey = actionKey;
      }
    }
    observe(metric, row, observedProbability, topActionKey === row.observedActionKey);
  }
  return finalize(metric);
}
function probabilities(actionKeys, counts) {
  const alpha = 0.25;
  const totalObserved = counts
    ? [...counts.values()].reduce((sum, value) => sum + value, 0)
    : 0;
  const denominator = totalObserved + alpha * actionKeys.length;
  return new Map(
    actionKeys.map((actionKey) => [
      actionKey,
      ((counts?.get(actionKey) ?? 0) + alpha) /
        Math.max(denominator, alpha * actionKeys.length),
    ]),
  );
}
function stateKey(row, enriched) {
  const base = [
    `H=${row.state.heroId}`,
    `P=${row.state.phase}`,
    `T=${Math.floor(Number(row.state.gameTimeS) / 300)}`,
    `E=${economyBand(Number(row.state.netWorth))}`,
    `I=${Math.min(12, Number(row.state.inventoryItemCount ?? 0))}`,
    `L=${row.state.previousActionKey ?? 'NONE'}`,
  ];
  if (!enriched) return base.join('|');
  const observability = (row.observability ?? [])
    .filter((observation) => observation.missing !== true)
    .map((observation) => `${observation.fieldName}=${observation.value}`)
    .sort();
  return [...base, ...observability].join('|');
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
    groups: [...metric.groups.entries()].map(([key, group]) => ({
      key,
      decisionCount: group.decisions,
      supportCoverage: ratio(group.support, group.decisions),
      rawLogLoss: ratio(group.loss, group.decisions),
    })),
  };
}
function combine(directions) {
  return {
    baseline: combineMetrics(directions.map((value) => value.baseline)),
    enriched: combineMetrics(directions.map((value) => value.enriched)),
  };
}
function combineMetrics(metrics) {
  const total = metrics.reduce((sum, metric) => sum + metric.decisionCount, 0);
  const groups = new Map();
  for (const metric of metrics) {
    for (const group of metric.groups) {
      const value = groups.get(group.key) ?? { decisions: 0, support: 0, loss: 0 };
      value.decisions += group.decisionCount;
      value.support += group.supportCoverage * group.decisionCount;
      value.loss += group.rawLogLoss * group.decisionCount;
      groups.set(group.key, value);
    }
  }
  return {
    decisionCount: total,
    supportCoverage: weighted(metrics, 'supportCoverage'),
    rawLogLoss: weighted(metrics, 'rawLogLoss'),
    top1Rate: weighted(metrics, 'top1Rate'),
    groups: [...groups.entries()].map(([key, value]) => ({
      key,
      decisionCount: value.decisions,
      supportCoverage: ratio(value.support, value.decisions),
      rawLogLoss: ratio(value.loss, value.decisions),
    })),
  };
}
function weighted(metrics, field) {
  const total = metrics.reduce((sum, metric) => sum + metric.decisionCount, 0);
  return ratio(
    metrics.reduce((sum, metric) => sum + metric[field] * metric.decisionCount, 0),
    total,
  );
}
function groupKeys(row) {
  return [
    `PHASE:${row.state.phase}`,
    `ECONOMY:${economyBand(Number(row.state.netWorth))}`,
  ];
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
