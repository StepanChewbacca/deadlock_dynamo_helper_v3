import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import {
  behavioralV7ContinuationChecks,
  behavioralV7GroupSupport,
  createBehavioralV7Metric,
  finalizeBehavioralV7Metric,
  observeBehavioralV7Metric,
  selectBehavioralV7ChoiceSet,
} from './recommendation-behavioral-v7-evaluation.mjs';
import {
  BEHAVIORAL_V7_LINEAR_FAMILY,
  BEHAVIORAL_V7_MODEL_FAMILIES,
  BEHAVIORAL_V7_SEQUENCE_CONFIG,
  BEHAVIORAL_V7_SEQUENCE_FAMILY,
  chooseBehavioralV7Champion,
  createBehavioralV7ModelFamily,
} from './recommendation-behavioral-v7-model-families.mjs';

const datasetPath = required('BEHAVIORAL_V7_DATASET_PATH');
const stageEPath = required('BEHAVIORAL_V7_STAGE_E_PATH');
const outputDirectory = required('BEHAVIORAL_V7_BOUNDED_OUTPUT_DIR');

const executorVersion = 'V7_STAGE_F_FIXED_FAMILY_COMPARISON_1';
const epochs = 3;
const v6SequenceCapacityReference = Object.freeze({
  historyLength: 16,
  hiddenDimension: 12,
  sequenceEmbeddingHashDimension: 4_096,
  contextEmbeddingHashDimension: 2_048,
  candidateEmbeddingHashDimension: 4_096,
  candidateBiasHashDimension: 8_192,
  recurrenceDecay: 0.8,
});

await validatePrerequisites();
await mkdir(outputDirectory, { recursive: true });

const familyStates = BEHAVIORAL_V7_MODEL_FAMILIES.map((familyId) => {
  const adapter = createBehavioralV7ModelFamily(familyId);
  return {
    familyId,
    adapter,
    model: adapter.createModel(),
    trainingEpochs: [],
  };
});

for (let epoch = 1; epoch <= epochs; epoch += 1) {
  const reports = await trainEpoch(familyStates, epoch);
  for (const state of familyStates) {
    state.adapter.validate(state.model);
    state.trainingEpochs.push(reports[state.familyId]);
  }
  console.log(
    JSON.stringify({
      progress: 'TRAIN_EPOCH_COMPLETE',
      epoch,
      families: reports,
    }),
  );
}

const evaluation = await evaluateTuning(familyStates);
const familyResults = familyStates.map((state) => {
  const tuning = evaluation.metrics[state.familyId];
  return {
    familyId: state.familyId,
    contracts: state.adapter.contracts,
    modelConfig: state.adapter.modelConfig,
    trainingOptions: state.adapter.trainingOptions,
    trainingEpochs: state.trainingEpochs,
    tuning,
    lateSupportCoverage: behavioralV7GroupSupport(tuning.groups, 'PHASE:LATE'),
    highEconomySupportCoverage: behavioralV7GroupSupport(
      tuning.groups,
      'ECONOMY:GE_20000',
    ),
  };
});
const champion = chooseBehavioralV7Champion(familyResults);
const continuationChecks = behavioralV7ContinuationChecks(
  champion.tuning,
  evaluation.candidateCoverage,
);
const stageFContractChecks = {
  exactFixedFamilyCount: familyResults.length === 2,
  linearBaselinePresent: familyResults.some(
    (result) => result.familyId === BEHAVIORAL_V7_LINEAR_FAMILY,
  ),
  sameCapacitySequencePresent: familyResults.some(
    (result) => result.familyId === BEHAVIORAL_V7_SEQUENCE_FAMILY,
  ),
  sequenceCapacityMatchesV6Reference:
    JSON.stringify(BEHAVIORAL_V7_SEQUENCE_CONFIG) ===
    JSON.stringify(v6SequenceCapacityReference),
  allFamiliesConsumeV7Observability: familyResults.every(
    (result) => result.contracts.consumesV7Observability === true,
  ),
  rawPropensityContractsOnly: familyResults.every(
    (result) => result.contracts.probabilityContract === 'RAW_SOFTMAX_WITHIN_DECISION',
  ),
  sharedCandidateCoverageAtLeast099: evaluation.candidateCoverage >= 0.99,
  tuningExcludedFromTraining: true,
  tuningExcludedFromEarlyStopping: true,
  futureTestExcluded: evaluation.futureTestRowCount === 0,
};
const screenPassed =
  Object.values(stageFContractChecks).every(Boolean) &&
  Object.values(continuationChecks).every(Boolean);

for (const state of familyStates) {
  await writeJson(`${outputDirectory}/model-${fileSafeFamily(state.familyId)}.json`, {
    schemaVersion: 1,
    operation: 'RECOMMENDATION_BEHAVIORAL_V7_BOUNDED_SCREEN_MODEL',
    executorVersion,
    familyId: state.familyId,
    diagnosticOnly: true,
    trainingArtifactEligible: false,
    modelConfig: state.adapter.modelConfig,
    trainingConfig: {
      epochs,
      ...state.adapter.trainingOptions,
    },
    contracts: state.adapter.contracts,
    model: state.model,
  });
}
const championState = familyStates.find(
  (state) => state.familyId === champion.familyId,
);
if (!championState) throw new Error('Behavioral V7 bounded champion model is missing.');
await writeJson(`${outputDirectory}/model.json`, {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_BOUNDED_SCREEN_MODEL',
  executorVersion,
  familyId: champion.familyId,
  diagnosticOnly: true,
  trainingArtifactEligible: false,
  modelConfig: championState.adapter.modelConfig,
  trainingConfig: {
    epochs,
    ...championState.adapter.trainingOptions,
  },
  contracts: championState.adapter.contracts,
  model: championState.model,
});

const summary = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_BOUNDED_SCREEN',
  executorVersion,
  generatedAt: new Date().toISOString(),
  source: {
    datasetPath,
    stageEPath,
    futureTestRowCount: evaluation.futureTestRowCount,
  },
  contracts: {
    stageFContract: 'FIXED_LINEAR_AND_V6_CAPACITY_SEQUENCE_COMPARISON_1',
    behavioralChoiceSetDefinition: 'V7_OBSERVED_AVAILABILITY_TOP96_1',
    matchSplitContract: 'IMMUTABLE_DATASET_V7_MATCH_SPLIT',
    tuningUsedForTraining: false,
    tuningUsedForEarlyStopping: false,
    futureTestEvaluated: false,
    probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
  },
  candidateCoverage: evaluation.candidateCoverage,
  familyResults,
  championFamily: champion.familyId,
  champion: {
    supportCoverage: champion.tuning.supportCoverage,
    rawLogLoss: champion.tuning.rawLogLoss,
    top1Rate: champion.tuning.top1Rate,
    floorSensitivityDelta: champion.tuning.floorSensitivityDelta,
    majorLowSupportGroupCount: champion.tuning.majorLowSupportGroupCount,
    lateSupportCoverage: champion.lateSupportCoverage,
    highEconomySupportCoverage: champion.highEconomySupportCoverage,
  },
  supportCoverage: champion.tuning.supportCoverage,
  rawLogLoss: champion.tuning.rawLogLoss,
  top1Rate: champion.tuning.top1Rate,
  floorSensitivityDelta: champion.tuning.floorSensitivityDelta,
  majorLowSupportGroupCount: champion.tuning.majorLowSupportGroupCount,
  lateSupportCoverage: champion.lateSupportCoverage,
  highEconomySupportCoverage: champion.highEconomySupportCoverage,
  stageFContractChecks,
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
    stageE.trainingArtifactEligible !== false ||
    stageE.nextAuthorizedOperation !== 'BOUNDED_BEHAVIORAL_V7_SCREEN'
  ) {
    throw new Error(
      'Stage E information-gain evidence does not permit a bounded V7 screen.',
    );
  }
}

async function trainEpoch(states, epoch) {
  const reports = Object.fromEntries(
    states.map((state) => [
      state.familyId,
      { epoch, decisionCount: 0, lossSum: 0 },
    ]),
  );
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
    const selected = selectBehavioralV7ChoiceSet(row);
    if (!selected) continue;
    for (const state of states) {
      const report = reports[state.familyId];
      report.lossSum += state.adapter.train(state.model, selected);
      report.decisionCount += 1;
    }
  }
  assertNoFutureTest(futureTestRowCount);
  return Object.fromEntries(
    Object.entries(reports).map(([familyId, report]) => [
      familyId,
      {
        epoch: report.epoch,
        decisionCount: report.decisionCount,
        meanOnlineLoss: divide(report.lossSum, report.decisionCount),
      },
    ]),
  );
}

async function evaluateTuning(states) {
  const metrics = Object.fromEntries(
    states.map((state) => [state.familyId, createBehavioralV7Metric()]),
  );
  let eligibleSelectionRows = 0;
  let coveredSelectionRows = 0;
  let tuningDecisionCount = 0;
  let futureTestRowCount = 0;
  const input = createInterface({ input: openDataset(datasetPath), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
      continue;
    }
    if (!['TRAIN', 'TUNING'].includes(row.split)) continue;
    if (row.eligibility?.behavioralModel !== true) continue;
    eligibleSelectionRows += 1;
    const selected = selectBehavioralV7ChoiceSet(row);
    if (selected) coveredSelectionRows += 1;
    if (row.split !== 'TUNING' || !selected) continue;
    tuningDecisionCount += 1;
    for (const state of states) {
      observeBehavioralV7Metric(
        metrics[state.familyId],
        selected,
        state.adapter.predict(state.model, selected),
      );
    }
  }
  assertNoFutureTest(futureTestRowCount);
  if (tuningDecisionCount === 0) {
    throw new Error('Behavioral V7 bounded screen evaluated no TUNING decisions.');
  }
  return {
    candidateCoverage: divide(coveredSelectionRows, eligibleSelectionRows),
    futureTestRowCount,
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([familyId, metric]) => [
        familyId,
        finalizeBehavioralV7Metric(metric),
      ]),
    ),
  };
}

function assertNoFutureTest(count) {
  if (count !== 0) {
    throw new Error(
      `Dataset V7 bounded input must exclude FUTURE_TEST rows, got ${count}.`,
    );
  }
}

function fileSafeFamily(familyId) {
  return familyId.toLowerCase().replaceAll('_', '-');
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
    `championFamily=${summary.championFamily}`,
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
