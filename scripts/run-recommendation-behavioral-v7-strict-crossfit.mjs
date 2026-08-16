import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
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
const probabilityTolerance = 1e-9;

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
const propensityPath = `${outputDirectory}/propensities.ndjson`;
const propensityStream = createWriteStream(propensityPath, {
  encoding: 'utf8',
  flags: 'w',
});
const propensityStats = {
  rowCount: 0,
  candidateProbabilityCount: 0,
  invalidProbabilityCount: 0,
  normalizationViolationCount: 0,
  observedProbabilityMismatchCount: 0,
};

const oofMetric = createBehavioralV7Metric();
let oofEligibleRowCount = 0;
let oofCoveredRowCount = 0;
const foldReports = [];
try {
  for (let holdout = 0; holdout < folds; holdout += 1) {
    const model = family.createModel();
    const trainingEpochs = [];
    for (let epoch = 1; epoch <= epochs; epoch += 1) {
      trainingEpochs.push(await trainFoldEpoch(model, holdout, epoch));
    }
    family.validate(model);
    const evaluation = await evaluateHoldout(
      model,
      holdout,
      oofMetric,
      propensityStream,
      propensityStats,
    );
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
} finally {
  propensityStream.end();
  await finished(propensityStream);
}

if (propensityStats.rowCount !== oofCoveredRowCount) {
  throw new Error(
    `Behavioral V7 OOF propensity row count mismatch: ${propensityStats.rowCount} versus ${oofCoveredRowCount}.`,
  );
}
if (
  propensityStats.invalidProbabilityCount !== 0 ||
  propensityStats.normalizationViolationCount !== 0 ||
  propensityStats.observedProbabilityMismatchCount !== 0
) {
  throw new Error(
    `Behavioral V7 OOF raw propensity contract failed: ${JSON.stringify(propensityStats)}.`,
  );
}
const propensitySha256 = await hashFile(propensityPath);

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
const oofPropensityContractPassed =
  propensityStats.rowCount > 0 &&
  propensityStats.invalidProbabilityCount === 0 &&
  propensityStats.normalizationViolationCount === 0 &&
  propensityStats.observedProbabilityMismatchCount === 0;
const trainingArtifactEligible =
  strictCrossFitPassed &&
  independentTuningPassed &&
  familyContractPreserved &&
  oofPropensityContractPassed;

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

const propensityManifest = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_OOF_PROPENSITY_ARTIFACT',
  generatedAt: new Date().toISOString(),
  familyId,
  source: {
    datasetPath,
    boundedSummaryPath,
    boundedChampionFamily: bounded.championFamily,
  },
  artifact: {
    fileName: 'propensities.ndjson',
    sha256: propensitySha256,
    rowCount: propensityStats.rowCount,
    candidateProbabilityCount: propensityStats.candidateProbabilityCount,
  },
  contracts: {
    probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
    split: 'TRAIN',
    outOfFold: true,
    matchFoldAssignment: 'FNV1A32_MATCH_ID_MOD_5',
    inFoldPredictionUsed: false,
    tuningUsedForPropensity: false,
    futureTestUsedForPropensity: false,
    probabilityNormalizationTolerance: probabilityTolerance,
    boundedChampionFamilyPreserved: true,
  },
  audit: {
    ...propensityStats,
    rawPropensityContractPassed: oofPropensityContractPassed,
  },
  trainingArtifactEligible,
  valueV8InputEligible: trainingArtifactEligible,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
};
await writeJson(`${outputDirectory}/propensity-manifest.json`, propensityManifest);

const summary = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_STRICT_CROSSFIT',
  executorVersion: 'MATCH_FOLD_5_BOUND_FAMILY_OOF_PROPENSITY_3',
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
    trainOofRawPropensityArtifact: true,
    tuningUsedForTraining: false,
    tuningUsedForEarlyStopping: false,
    tuningUsedForPropensity: false,
    futureTestEvaluated: false,
    futureTestUsedForPropensity: false,
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
  oofPropensityArtifact: {
    fileName: 'propensities.ndjson',
    manifestFileName: 'propensity-manifest.json',
    sha256: propensitySha256,
    rowCount: propensityStats.rowCount,
    rawPropensityContractPassed: oofPropensityContractPassed,
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
  oofPropensityContractPassed,
  strictCrossFitPassed,
  independentTuningPassed,
  trainingArtifactEligible,
  fullTrainingRecommended: trainingArtifactEligible,
  valueV8InputEligible: trainingArtifactEligible,
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

async function evaluateHoldout(
  model,
  holdout,
  targetMetric,
  targetPropensityStream,
  targetPropensityStats,
) {
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
    const prediction = family.predict(model, selected);
    observeBehavioralV7Metric(targetMetric, selected, prediction);
    await writeOofPropensity(
      targetPropensityStream,
      targetPropensityStats,
      selected,
      prediction,
      holdout,
    );
  }
  assertNoFutureTest(futureTestRowCount);
  return {
    eligibleRowCount,
    coveredRowCount,
    candidateCoverage: divide(coveredRowCount, eligibleRowCount),
    propensityRowCount: coveredRowCount,
  };
}

async function writeOofPropensity(
  stream,
  stats,
  row,
  prediction,
  holdout,
) {
  const observedCandidate = row.candidates.find(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  if (!observedCandidate) {
    throw new Error('Behavioral V7 OOF observed action is missing from choice set.');
  }
  let probabilitySum = 0;
  let observedCandidateProbability;
  const candidates = prediction.candidates.map((candidate) => {
    const rawProbability = Number(candidate.probability);
    stats.candidateProbabilityCount += 1;
    if (
      !Number.isFinite(rawProbability) ||
      rawProbability < 0 ||
      rawProbability > 1
    ) {
      stats.invalidProbabilityCount += 1;
    } else {
      probabilitySum += rawProbability;
    }
    if (candidate.actionKey === row.observedActionKey) {
      observedCandidateProbability = rawProbability;
    }
    return {
      actionKey: candidate.actionKey,
      itemId: candidate.itemId,
      rawProbability,
    };
  });
  if (Math.abs(probabilitySum - 1) > probabilityTolerance) {
    stats.normalizationViolationCount += 1;
  }
  if (
    observedCandidateProbability === undefined ||
    Math.abs(
      observedCandidateProbability - Number(prediction.observedActionProbability),
    ) > probabilityTolerance
  ) {
    stats.observedProbabilityMismatchCount += 1;
  }
  if (
    stats.invalidProbabilityCount !== 0 ||
    stats.normalizationViolationCount !== 0 ||
    stats.observedProbabilityMismatchCount !== 0
  ) {
    throw new Error(
      `Behavioral V7 OOF prediction violates raw propensity contract at ${row.decisionId}.`,
    );
  }

  const propensityRow = {
    schemaVersion: 1,
    propensityVersion: 'RECOMMENDATION_BEHAVIORAL_V7_OOF_PROPENSITY_1',
    modelFamily: familyId,
    modelVersion: family.contracts.modelVersion,
    featureVersion: family.contracts.featureVersion,
    probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
    split: 'TRAIN',
    outOfFold: true,
    foldCount: folds,
    holdoutFold: holdout,
    decisionId: row.decisionId,
    sourceDecisionId: row.sourceDecisionId,
    matchId: row.matchId,
    playerId: row.playerId,
    ...(row.accountId !== undefined ? { accountId: row.accountId } : {}),
    ...(row.playerIdentitySource !== undefined
      ? { playerIdentitySource: row.playerIdentitySource }
      : {}),
    heroId: row.state.heroId,
    gameTimeS: row.state.gameTimeS,
    observedActionKey: row.observedActionKey,
    observedActionItemId: observedCandidate.itemId,
    observedActionRawProbability: Number(prediction.observedActionProbability),
    candidates,
  };
  const serialized = `${JSON.stringify(propensityRow)}\n`;
  if (!stream.write(serialized)) {
    await new Promise((resolve, reject) => {
      stream.once('drain', resolve);
      stream.once('error', reject);
    });
  }
  stats.rowCount += 1;
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

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
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
