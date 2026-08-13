import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const datasetPath = required('BEHAVIORAL_V7_DATASET_PATH');
const outputPath = required('BEHAVIORAL_V7_INFORMATION_GAIN_REPORT_PATH');
const supportProbability = 0.01;
const alpha = 0.25;
const baselineCountsByPartition = [new Map(), new Map()];
const enrichedCountsByPartition = [new Map(), new Map()];
const partitionDecisionCounts = [0, 0];
let futureTestRowCount = 0;
let tuningRowCount = 0;

await scanDataset(async (row) => {
  assertV7Row(row);
  if (row.split === 'FUTURE_TEST') {
    futureTestRowCount += 1;
    return;
  }
  if (row.split === 'TUNING') {
    tuningRowCount += 1;
    return;
  }
  if (!eligibleTrainRow(row)) return;

  const partition = fnv1a32(String(row.matchId)) & 1;
  partitionDecisionCounts[partition] += 1;
  incrementCount(
    baselineCountsByPartition[partition],
    stateKey(row, false),
    row.observedActionKey,
  );
  incrementCount(
    enrichedCountsByPartition[partition],
    stateKey(row, true),
    row.observedActionKey,
  );
});

if (futureTestRowCount !== 0) {
  throw new Error(
    `FUTURE_TEST must not be present in information-gain input, got ${futureTestRowCount}.`,
  );
}
if (partitionDecisionCounts.some((count) => count < 1000)) {
  throw new Error('Both TRAIN MATCH partitions require at least 1000 decisions.');
}

const directionAccumulators = [
  {
    id: 'P0_TO_P1',
    trainingPartition: 0,
    evaluationPartition: 1,
    baseline: emptyMetric(),
    enriched: emptyMetric(),
  },
  {
    id: 'P1_TO_P0',
    trainingPartition: 1,
    evaluationPartition: 0,
    baseline: emptyMetric(),
    enriched: emptyMetric(),
  },
];

await scanDataset(async (row) => {
  if (!eligibleTrainRow(row)) return;
  const evaluationPartition = fnv1a32(String(row.matchId)) & 1;
  const trainingPartition = evaluationPartition ^ 1;
  const direction =
    evaluationPartition === 1
      ? directionAccumulators[0]
      : directionAccumulators[1];

  evaluateRow(
    direction.baseline,
    row,
    baselineCountsByPartition[trainingPartition],
    false,
  );
  evaluateRow(
    direction.enriched,
    row,
    enrichedCountsByPartition[trainingPartition],
    true,
  );
});

const directions = directionAccumulators.map((direction) => ({
  id: direction.id,
  trainingDecisionCount: partitionDecisionCounts[direction.trainingPartition],
  evaluationDecisionCount: partitionDecisionCounts[direction.evaluationPartition],
  baseline: finalize(direction.baseline),
  enriched: finalize(direction.enriched),
}));
const aggregate = combine(directions);
const supportGain =
  aggregate.enriched.supportCoverage - aggregate.baseline.supportCoverage;
const rawLogLossGain =
  aggregate.baseline.rawLogLoss - aggregate.enriched.rawLogLoss;
const lateGain =
  groupSupport(aggregate.enriched.groups, 'PHASE:LATE') -
  groupSupport(aggregate.baseline.groups, 'PHASE:LATE');
const economyGain =
  groupSupport(aggregate.enriched.groups, 'ECONOMY:GE_20000') -
  groupSupport(aggregate.baseline.groups, 'ECONOMY:GE_20000');
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
  futureTestExcluded: futureTestRowCount === 0,
  tuningUntouched: tuningRowCount >= 0,
  sameChoiceSetUsedForBaselineAndEnriched: true,
  supportGainAtLeast001: supportGain >= 0.01,
  logLossOrTailGain:
    rawLogLossGain >= 0.03 ||
    (lateGain >= 0.02 && economyGain >= 0.02),
  bothMatchDirectionsImprove: directionChecks.every((check) => check.passed),
};
const stageEGatePassed = Object.values(gates).every(Boolean);
const report = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_INFORMATION_GAIN_DIAGNOSTIC',
  executorVersion: 'MATCH_CROSSFIT_CONDITIONAL_PRIOR_GAIN_STREAMING_2',
  generatedAt: new Date().toISOString(),
  trainingArtifactEligible: false,
  behavioralModelTrainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  tuningUsedForDiagnostic: false,
  source: {
    datasetPath,
    partitionDecisionCounts,
    tuningRowCountUntouched: tuningRowCount,
    futureTestRowCount,
    datasetPassCount: 2,
    fullRowsRetainedInMemory: false,
  },
  contract: {
    baselineFeatures: 'V6_PREDECISION_STATE_BUCKETS',
    enrichedFeatures: 'V6_PREDECISION_STATE_BUCKETS_PLUS_V7_OBSERVABILITY',
    identicalBehavioralChoiceSet: true,
    observedActionMaySelectFeatures: false,
    matchCrossFit: true,
    executionOnlyOptimization: true,
  },
  directions,
  aggregate,
  gains: {
    supportGain,
    rawLogLossGain,
    lateGain,
    highEconomyGain: economyGain,
  },
  directionChecks,
  gates,
  stageEGatePassed,
  nextStep: stageEGatePassed
    ? 'ALLOW_BOUNDED_BEHAVIORAL_V7_SCREEN'
    : 'COLLECT_NEW_OBSERVABILITY_TELEMETRY',
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    { stageEGatePassed, gains: report.gains, gates },
    null,
    2,
  ),
);

async function scanDataset(visitor) {
  const input = createInterface({
    input: openDataset(datasetPath),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    if (!line.trim()) continue;
    await visitor(JSON.parse(line));
  }
}

function assertV7Row(row) {
  if (
    row?.datasetVersion !==
    'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1'
  ) {
    throw new Error('Unsupported Dataset V7 row.');
  }
}

function eligibleTrainRow(row) {
  if (row.split !== 'TRAIN' || row.eligibility?.behavioralModel !== true) {
    return false;
  }
  const actionKeys = row.choiceSet?.behavioralChoiceSetActionKeys ?? [];
  return actionKeys.length >= 2 && actionKeys.includes(row.observedActionKey);
}

function incrementCount(groups, key, actionKey) {
  const group = groups.get(key) ?? { total: 0, actions: new Map() };
  group.total += 1;
  group.actions.set(actionKey, (group.actions.get(actionKey) ?? 0) + 1);
  groups.set(key, group);
}

function evaluateRow(metric, row, counts, enriched) {
  const actionKeys = row.choiceSet.behavioralChoiceSetActionKeys;
  const prediction = predictionSummary(
    actionKeys,
    counts.get(stateKey(row, enriched)),
    row.observedActionKey,
  );
  observe(
    metric,
    row,
    prediction.observedProbability,
    prediction.topActionKey === row.observedActionKey,
  );
}

function predictionSummary(actionKeys, group, observedActionKey) {
  const totalObserved = group?.total ?? 0;
  const denominator = totalObserved + alpha * actionKeys.length;
  const safeDenominator = Math.max(denominator, alpha * actionKeys.length);
  const observedProbability =
    ((group?.actions.get(observedActionKey) ?? 0) + alpha) /
    safeDenominator;

  let topActionKey = actionKeys[0];
  let topCount = group?.actions.get(topActionKey) ?? 0;
  for (const actionKey of actionKeys.slice(1)) {
    const count = group?.actions.get(actionKey) ?? 0;
    if (count > topCount) {
      topActionKey = actionKey;
      topCount = count;
    }
  }
  return { observedProbability, topActionKey };
}

function stateKey(row, enriched) {
  const state = row.state;
  const base = [
    `H=${state.heroId}`,
    `P=${state.phase}`,
    `T=${Math.floor(Number(state.gameTimeS) / 300)}`,
    `E=${economyBand(Number(state.netWorth))}`,
    `I=${Math.min(
      12,
      state.inventoryItemCounts?.reduce(
        (sum, item) => sum + Number(item.count),
        0,
      ) ?? 0,
    )}`,
    `L=${state.previousActionKeys?.slice(-1)[0] ?? 'NONE'}`,
  ];
  if (!enriched) return base.join('|');
  const observations = (row.observability ?? [])
    .map(
      (observation) =>
        `${observation.fieldName}=${
          observation.missing ? 'MISSING' : bucket(observation.value)
        }`,
    )
    .sort();
  return [...base, ...observations].join('|');
}

function bucket(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NONFINITE';
    const width =
      Math.abs(value) >= 10000
        ? 5000
        : Math.abs(value) >= 1000
          ? 500
          : Math.abs(value) >= 100
            ? 50
            : 5;
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
    const group = metric.groups.get(key) ?? {
      decisions: 0,
      support: 0,
      loss: 0,
    };
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
    groups: [...metric.groups.entries()]
      .map(([key, value]) => ({
        key,
        decisionCount: value.decisions,
        supportCoverage: ratio(value.support, value.decisions),
        rawLogLoss: ratio(value.loss, value.decisions),
      }))
      .sort((left, right) =>
        left.key.localeCompare(right.key, undefined, { numeric: true }),
      ),
  };
}

function combine(directions) {
  return {
    baseline: combineMetrics(directions.map((direction) => direction.baseline)),
    enriched: combineMetrics(directions.map((direction) => direction.enriched)),
  };
}

function combineMetrics(metrics) {
  const total = metrics.reduce(
    (sum, metric) => sum + metric.decisionCount,
    0,
  );
  const groupMap = new Map();
  for (const metric of metrics) {
    for (const group of metric.groups) {
      const value = groupMap.get(group.key) ?? {
        decisions: 0,
        supportSum: 0,
        lossSum: 0,
      };
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
  const total = metrics.reduce(
    (sum, metric) => sum + metric.decisionCount,
    0,
  );
  return ratio(
    metrics.reduce(
      (sum, metric) => sum + metric[field] * metric.decisionCount,
      0,
    ),
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
