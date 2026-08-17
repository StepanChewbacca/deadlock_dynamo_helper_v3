import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const datasetPath = required('BEHAVIORAL_V7_COMPACT_ROWS_PATH');
const stageDPath = required('BEHAVIORAL_V7_STAGE_D_PATH');
const outputPath = required('BEHAVIORAL_V7_INFORMATION_GAIN_REPORT_PATH');
const supportProbability = 0.01;
const executorVersion = 'MATCH_CROSSFIT_PLUS_INDEPENDENT_TUNING_FIXED_CHOICE_SET_6';
let evidenceWritten = false;

try {
  await main();
} catch (error) {
  if (!evidenceWritten) {
    await writeFailureEvidence(error);
  }
  throw error;
}

async function main() {
  const stageD = JSON.parse(await readFile(stageDPath, 'utf8'));
  const stageDValidation = validateStageDContract(stageD);
  if (!stageDValidation.passed) {
    const error = new Error(
      'Stage D does not permit V7 information-gain evaluation. Exact Stage D v3 contract must PASS.',
    );
    await writeFailureEvidence(error, { stageDValidation });
    throw error;
  }

  const trainPartitions = [[], [], []];
  const tuningRows = [];
  let futureTestRowCount = 0;
  const input = createInterface({ input: openDataset(datasetPath), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    assertCompactRowContract(row);
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
      continue;
    }
    if (!eligible(row)) continue;
    const normalized = normalizeRow(row);
    if (row.split === 'TRAIN') {
      trainPartitions[fnv1a32(String(row.matchId)) % trainPartitions.length].push(normalized);
    } else if (row.split === 'TUNING') {
      tuningRows.push(normalized);
    }
  }

  if (futureTestRowCount !== 0) {
    throw new Error(
      `Stage E compact input must exclude FUTURE_TEST rows, got ${futureTestRowCount}.`,
    );
  }
  if (trainPartitions.some((rows) => rows.length < 1000)) {
    throw new Error('All TRAIN match partitions require at least 1000 eligible decisions.');
  }
  if (tuningRows.length < 1000) {
    throw new Error('Independent TUNING requires at least 1000 eligible decisions.');
  }

  const crossFitDirections = trainPartitions.map((evaluationRows, evaluationIndex) => {
    const trainingRows = trainPartitions.flatMap((rows, index) =>
      index === evaluationIndex ? [] : rows,
    );
    return evaluateDirection(trainingRows, evaluationRows, `TRAIN_OOF_${evaluationIndex}`);
  });
  const trainOof = combine(crossFitDirections);
  const allTrainRows = trainPartitions.flat();
  const tuning = evaluateDirection(allTrainRows, tuningRows, 'TRAIN_TO_TUNING');
  const trainGains = calculateGains(trainOof);
  const tuningGains = calculateGains(tuning);
  const variableFamilyEvidence = evaluateVariableFamilies(
    allTrainRows,
    tuningRows,
    tuning.enriched,
  );
  const trainDirectionChecks = crossFitDirections.map((direction) => ({
    id: direction.id,
    supportGain:
      direction.enriched.supportCoverage - direction.baseline.supportCoverage,
    rawLogLossGain:
      direction.baseline.rawLogLoss - direction.enriched.rawLogLoss,
    passed:
      direction.enriched.supportCoverage >= direction.baseline.supportCoverage &&
      direction.enriched.rawLogLoss <= direction.baseline.rawLogLoss + 0.01,
  }));
  const tuningLateRawLogLossGain =
    groupLogLoss(tuning.baseline.groups, 'PHASE:LATE') -
    groupLogLoss(tuning.enriched.groups, 'PHASE:LATE');
  const tuningHighEconomyRawLogLossGain =
    groupLogLoss(tuning.baseline.groups, 'ECONOMY:GE_20000') -
    groupLogLoss(tuning.enriched.groups, 'ECONOMY:GE_20000');
  const overallSupportThresholdPass = tuningGains.supportGain >= 0.01;
  const lateInformationGainPass =
    tuningGains.lateGain >= 0.02 || tuningLateRawLogLossGain >= 0.03;
  const highEconomyInformationGainPass =
    tuningGains.highEconomyGain >= 0.02 ||
    tuningHighEconomyRawLogLossGain >= 0.03;
  const tuningRawLogLossImproved = tuningGains.rawLogLossGain > 0;
  const informationGainThresholdPass =
    overallSupportThresholdPass &&
    lateInformationGainPass &&
    highEconomyInformationGainPass &&
    tuningRawLogLossImproved;
  const trainCrossFitStable = trainDirectionChecks.every((check) => check.passed);

  const gates = {
    stageDPassed: stageDValidation.passed,
    futureTestExcluded: true,
    independentTuningEvaluated: true,
    tuningExcludedFromParameterUpdates: true,
    sameChoiceSetUsedForBaselineAndEnriched: true,
    capacityHeldFixed: true,
    candidateCoveragePreserved: stageDCoveragePassed(stageD),
    overallSupportThresholdPass,
    lateInformationGainPass,
    highEconomyInformationGainPass,
    tuningRawLogLossImproved,
    informationGainThresholdPass,
    measurableIncrementalVariableFamily: variableFamilyEvidence.some(
      (entry) => entry.measurable,
    ),
  };
  const stageEGatePassed = Object.values(gates).every(Boolean);
  const nextAuthorizedOperation = stageEGatePassed
    ? 'BOUNDED_BEHAVIORAL_V7_SCREEN'
    : 'COLLECT_NEW_OBSERVABILITY_TELEMETRY';
  const report = {
    schemaVersion: 6,
    operation: 'RECOMMENDATION_BEHAVIORAL_V7_INFORMATION_GAIN_DIAGNOSTIC',
    executorVersion,
    generatedAt: new Date().toISOString(),
    trainingArtifactEligible: false,
    behavioralModelTrainingPerformed: false,
    valueTrainingPerformed: false,
    futureTestEvaluated: false,
    tuningEvaluated: true,
    tuningUsedForParameterUpdates: false,
    source: {
      datasetPath,
      stageDPath,
      trainPartitionDecisionCounts: trainPartitions.map((rows) => rows.length),
      tuningDecisionCount: tuningRows.length,
      futureTestRowCount,
    },
    contract: {
      stageDContract:
        'RECOMMENDATION_BEHAVIORAL_V7_FEASIBLE_CHOICE_SET_AUDIT_SCHEMA_3',
      compactRowContract:
        'BEHAVIORAL_V7_CHOICE_SET_COMPACT_ROW_SCHEMA_1_TOP_LEVEL_ACTION_KEYS',
      baselineFeatures: 'V6_PREDECISION_STATE_BUCKETS',
      enrichedFeatures: 'V6_STATE_PLUS_V7_PREDECISION_OBSERVABILITY',
      identicalBehavioralChoiceSet: true,
      observedActionMaySelectFeatures: false,
      trainMatchCrossFit: true,
      independentTuningMatches: true,
      tuningUsedForFeatureSelection: false,
      futureTestUsed: false,
      continuationRule:
        'OVERALL_SUPPORT_GAIN_GE_0_01_AND_OVERALL_TUNING_RAW_LOGLOSS_IMPROVES_AND_(LATE_SUPPORT_GAIN_GE_0_02_OR_LATE_RAW_LOGLOSS_GAIN_GE_0_03)_AND_(HIGH_ECONOMY_SUPPORT_GAIN_GE_0_02_OR_HIGH_ECONOMY_RAW_LOGLOSS_GAIN_GE_0_03)',
    },
    stageDValidation,
    trainCrossFit: {
      directions: crossFitDirections,
      aggregate: trainOof,
      gains: trainGains,
      directionChecks: trainDirectionChecks,
    },
    tuning: {
      evaluation: tuning,
      gains: tuningGains,
      lateRawLogLossGain: tuningLateRawLogLossGain,
      highEconomyRawLogLossGain: tuningHighEconomyRawLogLossGain,
    },
    diagnostics: {
      trainCrossFitStable,
    },
    variableFamilyEvidence,
    gates,
    stageEGatePassed,
    nextAuthorizedOperation,
    nextStep: stageEGatePassed
      ? 'ALLOW_BOUNDED_BEHAVIORAL_V7_SCREEN'
      : 'COLLECT_NEW_OBSERVABILITY_TELEMETRY',
  };
  await writeReport(report);
  console.log(
    JSON.stringify(
      {
        stageEGatePassed,
        nextAuthorizedOperation,
        tuningGains,
        tuningLateRawLogLossGain,
        tuningHighEconomyRawLogLossGain,
        trainCrossFitStable,
        gates,
      },
      null,
      2,
    ),
  );
  if (!stageEGatePassed) process.exitCode = 2;
}

function validateStageDContract(value) {
  const gates = value?.gates;
  const contract = value?.contract;
  const checks = {
    schemaVersion: value?.schemaVersion === 3,
    operation:
      value?.operation ===
      'RECOMMENDATION_BEHAVIORAL_V7_FEASIBLE_CHOICE_SET_AUDIT',
    stageDGatePassed: value?.stageDGatePassed === true,
    futureTestNotEvaluated: value?.futureTestEvaluated === false,
    selectionUsesObservedAction: contract?.selectionUsesObservedAction === false,
    compactRowsUseIdenticalBehavioralChoiceSet:
      contract?.compactRowsUseIdenticalBehavioralChoiceSet === true,
    maximumCandidatesTop96: contract?.maximumCandidates === 96,
    futureTestExcluded: gates?.futureTestExcluded === true,
    observedActionNeverInjected: gates?.observedActionNeverInjected === true,
    overallCoverageAtLeast099: gates?.overallCoverageAtLeast099 === true,
    allMajorGroupsAtLeast095: gates?.allMajorGroupsAtLeast095 === true,
    availabilityModeExplicitlyDocumented:
      gates?.availabilityModeExplicitlyDocumented === true,
    compactRowsComplete: gates?.compactRowsComplete === true,
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}

function stageDCoveragePassed(value) {
  return (
    value?.gates?.overallCoverageAtLeast099 === true &&
    value?.gates?.allMajorGroupsAtLeast095 === true
  );
}

function assertCompactRowContract(row) {
  if (row?.schemaVersion !== 1) {
    throw new Error(
      `Unsupported Stage D compact row schemaVersion: ${row?.schemaVersion}.`,
    );
  }
  if (!Array.isArray(row.behavioralChoiceSetActionKeys)) {
    throw new Error(
      'Stage D compact row must expose top-level behavioralChoiceSetActionKeys.',
    );
  }
  if (row.choiceSet?.behavioralChoiceSetActionKeys !== undefined) {
    throw new Error(
      'Nested choiceSet.behavioralChoiceSetActionKeys is not part of compact row schema 1.',
    );
  }
}

function eligible(row) {
  const actionKeys = row.behavioralChoiceSetActionKeys;
  return (
    row.eligibility?.behavioralModel === true &&
    actionKeys.length >= 2 &&
    actionKeys.map(String).includes(String(row.observedActionKey))
  );
}

function normalizeRow(row) {
  return {
    ...row,
    behavioralChoiceSetActionKeys: row.behavioralChoiceSetActionKeys.map(String),
    observedActionKey: String(row.observedActionKey),
  };
}

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

function evaluateVariableFamilies(trainingRows, evaluationRows, fullEnrichedMetric) {
  const fieldNames = [
    ...new Set(
      trainingRows.flatMap((row) =>
        (row.observability ?? [])
          .filter((entry) => entry.missing !== true)
          .map((entry) => String(entry.fieldName)),
      ),
    ),
  ].sort();
  return fieldNames.map((fieldName) => {
    const counts = buildCounts(trainingRows, true, fieldName);
    const without = evaluate(evaluationRows, counts, true, fieldName);
    const supportContribution =
      fullEnrichedMetric.supportCoverage - without.supportCoverage;
    const rawLogLossContribution =
      without.rawLogLoss - fullEnrichedMetric.rawLogLoss;
    return {
      fieldName,
      supportContribution,
      rawLogLossContribution,
      measurable: supportContribution > 0 || rawLogLossContribution > 0,
    };
  });
}

function buildCounts(rows, enriched, excludedFieldName) {
  const groups = new Map();
  for (const row of rows) {
    const key = stateKey(row, enriched, excludedFieldName);
    const counts = groups.get(key) ?? new Map();
    counts.set(row.observedActionKey, (counts.get(row.observedActionKey) ?? 0) + 1);
    groups.set(key, counts);
  }
  return groups;
}

function evaluate(rows, counts, enriched, excludedFieldName) {
  const metric = emptyMetric();
  for (const row of rows) {
    const actionKeys = row.behavioralChoiceSetActionKeys;
    const prediction = probabilities(
      actionKeys,
      counts.get(stateKey(row, enriched, excludedFieldName)),
    );
    const observedProbability = prediction.get(row.observedActionKey) ?? 0;
    let topActionKey = actionKeys[0];
    for (const actionKey of actionKeys.slice(1)) {
      if (
        (prediction.get(actionKey) ?? 0) >
        (prediction.get(topActionKey) ?? 0)
      ) {
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

function stateKey(row, enriched, excludedFieldName) {
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
    .filter(
      (entry) =>
        entry.missing !== true && String(entry.fieldName) !== excludedFieldName,
    )
    .map((entry) => `${entry.fieldName}=${stableValue(entry.value)}`)
    .sort();
  return [...base, ...observability].join('|');
}

function stableValue(value) {
  return typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : String(value);
}

function calculateGains(value) {
  return {
    supportGain:
      value.enriched.supportCoverage - value.baseline.supportCoverage,
    rawLogLossGain: value.baseline.rawLogLoss - value.enriched.rawLogLoss,
    lateGain:
      groupSupport(value.enriched.groups, 'PHASE:LATE') -
      groupSupport(value.baseline.groups, 'PHASE:LATE'),
    highEconomyGain:
      groupSupport(value.enriched.groups, 'ECONOMY:GE_20000') -
      groupSupport(value.baseline.groups, 'ECONOMY:GE_20000'),
  };
}

function openDataset(path) {
  const stream = createReadStream(path);
  return path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
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
  const groups = new Map();
  for (const metric of metrics) {
    for (const group of metric.groups) {
      const value = groups.get(group.key) ?? {
        decisions: 0,
        support: 0,
        loss: 0,
      };
      value.decisions += group.decisionCount;
      value.support += group.supportCoverage * group.decisionCount;
      value.loss += group.rawLogLoss * group.decisionCount;
      groups.set(group.key, value);
    }
  }
  return {
    decisionCount: metrics.reduce(
      (sum, metric) => sum + metric.decisionCount,
      0,
    ),
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

function groupLogLoss(groups, key) {
  return (
    groups.find((group) => group.key === key)?.rawLogLoss ??
    Number.POSITIVE_INFINITY
  );
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

async function writeReport(value) {
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  evidenceWritten = true;
}

async function writeFailureEvidence(error, extra = {}) {
  const failure = {
    schemaVersion: 6,
    operation: 'RECOMMENDATION_BEHAVIORAL_V7_INFORMATION_GAIN_DIAGNOSTIC',
    executorVersion,
    generatedAt: new Date().toISOString(),
    trainingArtifactEligible: false,
    behavioralModelTrainingPerformed: false,
    valueTrainingPerformed: false,
    futureTestEvaluated: false,
    tuningUsedForParameterUpdates: false,
    stageEGatePassed: false,
    nextAuthorizedOperation: 'STOP_BEFORE_BEHAVIORAL_V7_TRAINING',
    nextStep: 'REVIEW_STAGE_E_BLOCKER',
    failure: {
      message: error instanceof Error ? error.message : String(error),
    },
    ...extra,
  };
  await writeReport(failure);
  console.error(JSON.stringify(failure, null, 2));
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
