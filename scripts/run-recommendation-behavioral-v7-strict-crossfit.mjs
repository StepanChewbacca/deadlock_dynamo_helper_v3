import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import {
  behavioralV7ContinuationChecks,
  behavioralV7GroupSupport,
  createBehavioralV7Metric,
  finalizeBehavioralV7Metric,
  fnv1a32,
  observeBehavioralV7Metric,
  selectBehavioralV7ChoiceSet,
} from './recommendation-behavioral-v7-evaluation.mjs';
import {
  BEHAVIORAL_V7_MODEL_FAMILIES,
  createBehavioralV7ModelFamily,
} from './recommendation-behavioral-v7-model-families.mjs';

const datasetPath = required('BEHAVIORAL_V7_DATASET_PATH');
const boundedSummaryPath = required('BEHAVIORAL_V7_BOUNDED_SUMMARY_PATH');
const outputDirectory = required('BEHAVIORAL_V7_CROSSFIT_OUTPUT_DIR');
const folds = 5;
const epochs = 3;

const bounded = JSON.parse(await readFile(boundedSummaryPath, 'utf8'));
if (
  bounded?.operation !== 'RECOMMENDATION_BEHAVIORAL_V7_BOUNDED_SCREEN' ||
  bounded?.schemaVersion !== 2 ||
  bounded?.screenPassed !== true ||
  bounded?.strictCrossFitRecommended !== true ||
  bounded?.trainingArtifactEligible !== false ||
  bounded?.source?.futureTestRowCount !== 0 ||
  bounded?.contracts?.futureTestEvaluated !== false ||
  bounded?.contracts?.tuningUsedForTraining !== false ||
  !BEHAVIORAL_V7_MODEL_FAMILIES.includes(bounded?.championFamily)
) {
  throw new Error('Bounded V7 evidence does not permit strict cross-fit.');
}

const familyId = bounded.championFamily;
const family = createBehavioralV7ModelFamily(familyId);
const modelConfig = family.modelConfig;
const options = family.trainingOptions;

const boundedChampionResult = bounded.familyResults?.find(
  (result) => result.familyId === familyId,
);
if (
  !boundedChampionResult ||
  boundedChampionResult.contracts?.probabilityContract !==
    'RAW_SOFTMAX_WITHIN_DECISION' ||
  boundedChampionResult.contracts?.consumesV7Observability !== true
) {
  throw new Error('Bounded V7 champion family contract is incomplete.');
}

await mkdir(outputDirectory, { recursive: true });

const oofMetric = createBehavioralV7Metric();
let oofEligibleRowCount = 0;
let oofCoveredRowCount = 0;
const foldReports = [];
for (let holdout = 0; holdout < folds; holdout += 1) {
  const model = family.createModel();
  const trainingEpochs = [];
  for (let epoch = 1; epoch <= epochs; epoch += 1) {
    trainingEpochs.push(await trainFoldEpoch(model, holdout, epoch));
  }
  family.validate(model);
  const evaluation = await evaluateHoldout(model, holdout, oofMetric);
  oofEligibleRowCount += evaluation.eligibleRowCount;
  oofCoveredRowCount += evaluation.coveredRowCount;
  foldReports.push({ holdout, trainingEpochs, evaluation });
  console.log(
    JSON.stringify({
      progress: 'CROSSFIT_HOLDOUT_COMPLETE',
      familyId,
      holdout,
      evaluation,
    }),
  );
}
const oof = finalizeBehavioralV7Metric(oofMetric);
const oofCandidateCoverage = divide(oofCoveredRowCount, oofEligibleRowCount);

const fullModel = family.createModel();
const fullTrainingEpochs = [];
for (let epoch = 1; epoch <= epochs; epoch += 1) {
  fullTrainingEpochs.push(await trainFullEpoch(fullModel, epoch));
}
family.validate(fullModel);
const tuningEvaluation = await evaluateTuning(fullModel);
const tuning = tuningEvaluation.metric;
const tuningCandidateCoverage = tuningEvaluation.candidateCoverage;
const oofChecks = behavioralV7ContinuationChecks(oof, oofCandidateCoverage);
const tuningChecks = behavioralV7ContinuationChecks(
  tuning,
  tuningCandidateCoverage,
);
const strictCrossFitPassed = Object.values(oofChecks).every(Boolean);
const independentTuningPassed = Object.values(tuningChecks).every(Boolean);
const familyContractPreserved =
  family.contracts.probabilityContract === 'RAW_SOFTMAX_WITHIN_DECISION' &&
  family.contracts.consumesV7Observability === true;
const trainingArtifactEligible =
  strictCrossFitPassed && independentTuningPassed && familyContractPreserved;

const modelArtifact = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_STRICT_CROSSFIT_FULL_TRAIN_MODEL',
  generatedAt: new Date().toISOString(),
  familyId,
  trainingArtifactEligible,
  contracts: family.contracts,
  modelConfig,
  trainingConfig: { folds, epochs, ...options },
  model: fullModel,
};
await writeJson(`${outputDirectory}/model.json`, modelArtifact);
const summary = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_STRICT_CROSSFIT',
  executorVersion: 'MATCH_FOLD_5_BOUND_FAMILY_2',
  generatedAt: new Date().toISOString(),
  familyId,
  source: {
    datasetPath,
    boundedSummaryPath,
    boundedChampionFamily: bounded.championFamily,
    futureTestRowCount: 0,
  },
  contracts: {
    ...family.contracts,
    matchFoldAssignment: 'FNV1A32_MATCH_ID_MOD_5',
    trainOofEvaluation: true,
    tuningUsedForTraining: false,
    tuningUsedForEarlyStopping: false,
    futureTestEvaluated: false,
    modelCapacityFrozen: true,
    boundedChampionFamilyPreserved: true,
  },
  modelConfig,
  trainingConfig: { folds, epochs, ...options },
  folds: foldReports,
  oof: {
    ...oof,
    candidateCoverage: oofCandidateCoverage,
    lateSupportCoverage: behavioralV7GroupSupport(oof.groups, 'PHASE:LATE'),
    highEconomySupportCoverage: behavioralV7GroupSupport(
      oof.groups,
      'ECONOMY:GE_20000',
    ),
  },
  fullTrainingEpochs,
  tuning: {
    ...tuning,
    candidateCoverage: tuningCandidateCoverage,
    lateSupportCoverage: behavioralV7GroupSupport(
      tuning.groups,
      'PHASE:LATE',
    ),
    highEconomySupportCoverage: behavioralV7GroupSupport(
      tuning.groups,
      'ECONOMY:GE_20000',
    ),
  },
  oofChecks,
  tuningChecks,
  familyContractPreserved,
  strictCrossFitPassed,
  independentTuningPassed,
  trainingArtifactEligible,
  fullTrainingRecommended: trainingArtifactEligible,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};
await writeJson(`${outputDirectory}/crossfit-summary.json`, summary);
console.log(JSON.stringify(summary, null, 2));

async function trainFoldEpoch(model, holdout, epoch) {
  let decisionCount = 0;
  let lossSum = 0;
  let futureTestRowCount = 0;
  const input = createInterface({ input: openDataset(datasetPath), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
      continue;
    }
    if (
      row.split !== 'TRAIN' ||
      row.eligibility?.behavioralModel !== true ||
      foldFor(row.matchId) === holdout
    ) {
      continue;
    }
    const selected = selectBehavioralV7ChoiceSet(row);
    if (!selected) continue;
    lossSum += family.train(model, selected);
    decisionCount += 1;
  }
  assertNoFutureTest(futureTestRowCount);
  return {
    epoch,
    decisionCount,
    meanOnlineLoss: divide(lossSum, decisionCount),
  };
}

async function evaluateHoldout(model, holdout, targetMetric) {
  let eligibleRowCount = 0;
  let coveredRowCount = 0;
  let futureTestRowCount = 0;
  const input = createInterface({ input: openDataset(datasetPath), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
      continue;
    }
    if (
      row.split !== 'TRAIN' ||
      row.eligibility?.behavioralModel !== true ||
      foldFor(row.matchId) !== holdout
    ) {
      continue;
    }
    eligibleRowCount += 1;
    const selected = selectBehavioralV7ChoiceSet(row);
    if (!selected) continue;
    coveredRowCount += 1;
    observeBehavioralV7Metric(
      targetMetric,
      selected,
      family.predict(model, selected),
    );
  }
  assertNoFutureTest(futureTestRowCount);
  return {
    eligibleRowCount,
    coveredRowCount,
    candidateCoverage: divide(coveredRowCount, eligibleRowCount),
  };
}

async function trainFullEpoch(model, epoch) {
  let decisionCount = 0;
  let lossSum = 0;
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
    lossSum += family.train(model, selected);
    decisionCount += 1;
  }
  assertNoFutureTest(futureTestRowCount);
  return {
    epoch,
    decisionCount,
    meanOnlineLoss: divide(lossSum, decisionCount),
  };
}

async function evaluateTuning(model) {
  const metric = createBehavioralV7Metric();
  let eligibleRowCount = 0;
  let coveredRowCount = 0;
  let futureTestRowCount = 0;
  const input = createInterface({ input: openDataset(datasetPath), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
      continue;
    }
    if (row.split !== 'TUNING' || row.eligibility?.behavioralModel !== true) continue;
    eligibleRowCount += 1;
    const selected = selectBehavioralV7ChoiceSet(row);
    if (!selected) continue;
    coveredRowCount += 1;
    observeBehavioralV7Metric(
      metric,
      selected,
      family.predict(model, selected),
    );
  }
  assertNoFutureTest(futureTestRowCount);
  return {
    metric: finalizeBehavioralV7Metric(metric),
    candidateCoverage: divide(coveredRowCount, eligibleRowCount),
  };
}

function foldFor(matchId) {
  return fnv1a32(String(matchId)) % folds;
}

function assertNoFutureTest(count) {
  if (count !== 0) {
    throw new Error(`Strict V7 cross-fit input contains FUTURE_TEST rows: ${count}.`);
  }
}

function openDataset(path) {
  const stream = createReadStream(path);
  return path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
