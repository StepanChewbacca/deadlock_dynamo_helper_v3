import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createRecommendationBehavioralV7Model,
  predictRecommendationBehavioralV7,
  trainRecommendationBehavioralV7Decision,
  validateRecommendationBehavioralV7Model,
  RECOMMENDATION_BEHAVIORAL_V7_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V7_FEATURE_VERSION,
  RECOMMENDATION_BEHAVIORAL_V7_PROBABILITY_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V7_OPTIMIZER,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v7.js');

const datasetPath = required('BEHAVIORAL_V7_DATASET_PATH');
const stageEPath = required('BEHAVIORAL_V7_STAGE_E_PATH');
const outputDirectory = required('BEHAVIORAL_V7_BOUNDED_OUTPUT_DIR');

const executorVersion = 'V7_OBSERVABILITY_CONDITIONAL_LOGIT_BOUNDED_1';
const modelConfig = { hashDimension: 65_536 };
const trainingConfig = {
  epochs: 3,
  learningRate: 0.05,
  l2: 0.0001,
  gradientClip: 1,
  supportProbability: 0.01,
  propensityFloors: [0.005, 0.01, 0.02],
  majorGroupMinDecisions: 100,
};

await validatePrerequisites();
await mkdir(outputDirectory, { recursive: true });
const model = createRecommendationBehavioralV7Model(modelConfig);
const trainingEpochs = [];
for (let epoch = 1; epoch <= trainingConfig.epochs; epoch += 1) {
  const result = await trainEpoch(model, epoch);
  validateRecommendationBehavioralV7Model(model);
  trainingEpochs.push(result);
  console.log(JSON.stringify({ progress: 'TRAIN_EPOCH_COMPLETE', ...result }));
}
const tuning = await evaluateTuning(model);
const lateSupportCoverage = supportForGroup(tuning.groups, 'PHASE:LATE');
const highEconomySupportCoverage = supportForGroup(
  tuning.groups,
  'ECONOMY:GE_20000',
);
const continuationChecks = {
  candidateCoverageAtLeast099: tuning.candidateCoverage >= 0.99,
  supportAtLeast086: tuning.supportCoverage >= 0.86,
  supportGainAtLeast001:
    tuning.supportCoverage >= 0.835920177383592 + 0.01,
  rawLogLossBeatsV6Sequence:
    tuning.rawLogLoss < 2.747655053608051,
  floorSensitivityBelow028:
    tuning.floorSensitivityDelta < 0.28,
  majorLowSupportGroupsAtMost2:
    tuning.majorLowSupportGroupCount <= 2,
  lateSupportBeatsV6:
    lateSupportCoverage > 0.7670886075949367,
  highEconomySupportBeatsV6:
    highEconomySupportCoverage > 0.7611583421891605,
};
const screenPassed = Object.values(continuationChecks).every(Boolean);

const modelArtifact = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_BOUNDED_SCREEN_MODEL',
  executorVersion,
  diagnosticOnly: true,
  trainingArtifactEligible: false,
  modelConfig,
  trainingConfig,
  model,
};
await writeJson(`${outputDirectory}/model.json`, modelArtifact);
const summary = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_BOUNDED_SCREEN',
  executorVersion,
  generatedAt: new Date().toISOString(),
  source: {
    datasetPath,
    stageEPath,
    futureTestRowCount: 0,
  },
  contracts: {
    modelVersion: RECOMMENDATION_BEHAVIORAL_V7_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V7_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V7_PROBABILITY_CONTRACT,
    optimizerContract: RECOMMENDATION_BEHAVIORAL_V7_OPTIMIZER,
    behavioralChoiceSetDefinition: 'V7_OBSERVED_AVAILABILITY_TOP96_1',
  },
  modelConfig,
  trainingConfig,
  training: {
    epochs: trainingEpochs,
    tuningUsedForTraining: false,
    tuningUsedForEarlyStopping: false,
    crossFittingPerformed: false,
    rowsMaterializedInHeap: false,
  },
  tuning,
  candidateCoverage: tuning.candidateCoverage,
  supportCoverage: tuning.supportCoverage,
  rawLogLoss: tuning.rawLogLoss,
  top1Rate: tuning.top1Rate,
  floorSensitivityDelta: tuning.floorSensitivityDelta,
  majorLowSupportGroupCount: tuning.majorLowSupportGroupCount,
  lateSupportCoverage,
  highEconomySupportCoverage,
  continuationChecks,
  screenPassed,
  strictCrossFitRecommended: screenPassed,
  diagnosticOnly: true,
  trainingArtifactEligible: false,
  fullTrainingAuthorized: false,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};
await writeJson(`${outputDirectory}/screen-summary.json`, summary);
await writeFile(
  `${outputDirectory}/screen-report.txt`,
  renderReport(summary),
  'utf8',
);
console.log(JSON.stringify(summary, null, 2));

async function validatePrerequisites() {
  const stageE = JSON.parse(await readFile(stageEPath, 'utf8'));
  if (
    stageE.operation !== 'RECOMMENDATION_BEHAVIORAL_V7_INFORMATION_GAIN_DIAGNOSTIC' ||
    stageE.stageEGatePassed !== true ||
    stageE.futureTestEvaluated !== false ||
    stageE.source?.futureTestRowCount !== 0 ||
    stageE.trainingArtifactEligible !== false
  ) {
    throw new Error(
      'Stage E information-gain evidence does not permit a bounded V7 screen.',
    );
  }
}

async function trainEpoch(model, epoch) {
  let decisionCount = 0;
  let lossSum = 0;
  let rawFeatureTouches = 0;
  let uniqueParameterUpdates = 0;
  let futureTestRowCount = 0;
  const input = createInterface({ input: openDataset(datasetPath), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
      continue;
    }
    if (row.split !== 'TRAIN' || row.eligibility?.behavioralModel !== true) continue;
    const selected = selectBehavioralChoiceSet(row);
    if (!selected) continue;
    const result = trainRecommendationBehavioralV7Decision(
      model,
      selected,
      {
        learningRate: trainingConfig.learningRate,
        l2: trainingConfig.l2,
        gradientClip: trainingConfig.gradientClip,
      },
    );
    decisionCount += 1;
    lossSum += result.loss;
    rawFeatureTouches += result.optimizerAudit.rawFeatureTouches;
    uniqueParameterUpdates += result.optimizerAudit.uniqueParameterUpdates;
    if (decisionCount % 5000 === 0) {
      console.log(
        JSON.stringify({
          progress: 'TRAIN_ROWS',
          epoch,
          decisionCount,
          meanOnlineLoss: lossSum / decisionCount,
        }),
      );
    }
  }
  if (futureTestRowCount !== 0) {
    throw new Error(
      `Dataset V7 bounded input must exclude FUTURE_TEST rows, got ${futureTestRowCount}.`,
    );
  }
  return {
    epoch,
    decisionCount,
    meanOnlineLoss: divide(lossSum, decisionCount),
    optimizerAudit: {
      rawFeatureTouches,
      uniqueParameterUpdates,
      repeatedTouchRate:
        rawFeatureTouches > 0
          ? 1 - uniqueParameterUpdates / rawFeatureTouches
          : 0,
    },
  };
}

async function evaluateTuning(model) {
  const metric = createMetric();
  let allSelectionRows = 0;
  let coveredSelectionRows = 0;
  let futureTestRowCount = 0;
  const input = createInterface({ input: openDataset(datasetPath), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
      continue;
    }
    if (row.split !== 'TRAIN' && row.split !== 'TUNING') continue;
    allSelectionRows += 1;
    const selected = selectBehavioralChoiceSet(row);
    if (selected) coveredSelectionRows += 1;
    if (
      row.split !== 'TUNING' ||
      row.eligibility?.behavioralModel !== true ||
      !selected
    ) {
      continue;
    }
    const prediction = predictRecommendationBehavioralV7(model, selected);
    observeMetric(metric, selected, prediction);
  }
  if (futureTestRowCount !== 0) {
    throw new Error(
      `Dataset V7 bounded input must exclude FUTURE_TEST rows, got ${futureTestRowCount}.`,
    );
  }
  const finalized = finalizeMetric(metric);
  return {
    ...finalized,
    candidateCoverage: divide(coveredSelectionRows, allSelectionRows),
  };
}

function selectBehavioralChoiceSet(row) {
  const actionKeys = row.choiceSet?.behavioralChoiceSetActionKeys;
  if (!Array.isArray(actionKeys) || actionKeys.length < 2) return undefined;
  const allowed = new Set(actionKeys);
  const candidates = row.candidates
    .filter((candidate) => allowed.has(candidate.actionKey))
    .sort(
      (left, right) =>
        Number(left.rank) - Number(right.rank) ||
        String(left.actionKey).localeCompare(String(right.actionKey)),
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  if (
    candidates.length < 2 ||
    !candidates.some((candidate) => candidate.actionKey === row.observedActionKey)
  ) {
    return undefined;
  }
  return { ...row, candidates, observedActionInCandidateSet: true };
}

function createMetric() {
  return {
    decisionCount: 0,
    supportCount: 0,
    top1Count: 0,
    lossSum: 0,
    minimumObservedRawProbability: 1,
    floorLossSums: new Map(
      trainingConfig.propensityFloors.map((floor) => [floor, 0]),
    ),
    groups: new Map(),
  };
}

function observeMetric(metric, row, prediction) {
  const probability = prediction.observedActionProbability;
  metric.decisionCount += 1;
  metric.supportCount += probability >= trainingConfig.supportProbability ? 1 : 0;
  metric.top1Count += prediction.topActionKey === row.observedActionKey ? 1 : 0;
  metric.lossSum += -Math.log(Math.max(probability, 1e-15));
  metric.minimumObservedRawProbability = Math.min(
    metric.minimumObservedRawProbability,
    probability,
  );
  for (const floor of trainingConfig.propensityFloors) {
    const current = metric.floorLossSums.get(floor) ?? 0;
    metric.floorLossSums.set(
      floor,
      current + -Math.log(Math.max(probability, floor)),
    );
  }
  for (const key of groupKeys(row)) {
    const group = metric.groups.get(key) ?? {
      decisionCount: 0,
      supportCount: 0,
      lossSum: 0,
      top1Count: 0,
    };
    group.decisionCount += 1;
    group.supportCount +=
      probability >= trainingConfig.supportProbability ? 1 : 0;
    group.lossSum += -Math.log(Math.max(probability, 1e-15));
    group.top1Count +=
      prediction.topActionKey === row.observedActionKey ? 1 : 0;
    metric.groups.set(key, group);
  }
}

function finalizeMetric(metric) {
  const rawLogLoss = divide(metric.lossSum, metric.decisionCount);
  const floorSensitivity = trainingConfig.propensityFloors.map((floor) => {
    const logLoss = divide(
      metric.floorLossSums.get(floor) ?? 0,
      metric.decisionCount,
    );
    return {
      floor,
      logLoss,
      logLossDeltaFromRaw: Math.abs(logLoss - rawLogLoss),
    };
  });
  const groups = [...metric.groups.entries()]
    .map(([key, group]) => ({
      key,
      decisionCount: group.decisionCount,
      major: group.decisionCount >= trainingConfig.majorGroupMinDecisions,
      supportCoverage: divide(group.supportCount, group.decisionCount),
      rawLogLoss: divide(group.lossSum, group.decisionCount),
      top1Rate: divide(group.top1Count, group.decisionCount),
    }))
    .sort((left, right) =>
      left.key.localeCompare(right.key, undefined, { numeric: true }),
    );
  const majorLowSupportGroups = groups.filter(
    (group) => group.major && group.supportCoverage < 0.75,
  );
  return {
    decisionCount: metric.decisionCount,
    supportCoverage: divide(metric.supportCount, metric.decisionCount),
    rawLogLoss,
    top1Rate: divide(metric.top1Count, metric.decisionCount),
    minimumObservedRawProbability: metric.minimumObservedRawProbability,
    floorSensitivity,
    floorSensitivityDelta: Math.max(
      ...floorSensitivity.map((value) => value.logLossDeltaFromRaw),
    ),
    groups,
    majorLowSupportGroups,
    majorLowSupportGroupCount: majorLowSupportGroups.length,
  };
}

function groupKeys(row) {
  const time = Number(row.state.gameTimeS);
  return [
    `PHASE:${row.state.phase}`,
    `HERO:${row.state.heroId}`,
    `ECONOMY:${economyBand(Number(row.state.netWorth))}`,
    `TIME:${Math.floor(time / 300) * 5}-${Math.floor(time / 300) * 5 + 5}m`,
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

function supportForGroup(groups, key) {
  return groups.find((group) => group.key === key)?.supportCoverage ?? 0;
}

function openDataset(path) {
  const stream = createReadStream(path);
  return path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function renderReport(summary) {
  return [
    'Recommendation Behavioral V7 bounded screen',
    `screenPassed=${summary.screenPassed}`,
    `supportCoverage=${summary.supportCoverage}`,
    `rawLogLoss=${summary.rawLogLoss}`,
    `floorSensitivityDelta=${summary.floorSensitivityDelta}`,
    `majorLowSupportGroupCount=${summary.majorLowSupportGroupCount}`,
    `lateSupportCoverage=${summary.lateSupportCoverage}`,
    `highEconomySupportCoverage=${summary.highEconomySupportCoverage}`,
    `strictCrossFitRecommended=${summary.strictCrossFitRecommended}`,
    '',
  ].join('\n');
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
