import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const require = createRequire(import.meta.url);
const {
  createRecommendationBehavioralV6SequenceModel,
  predictRecommendationBehavioralV6Sequence,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_BASE_SCORE,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_ENCODER,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_FEATURE_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OBJECTIVE,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OPTIMIZER,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_PROBABILITY_CONTRACT,
  trainRecommendationBehavioralV6SequenceDecision,
  validateRecommendationBehavioralV6SequenceModel,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v6-sequence-neural.js');

const samplePath = required('BEHAVIORAL_V6_SAMPLE_PATH');
const choiceSetReportPath = required('BEHAVIORAL_V6_CHOICE_SET_REPORT_PATH');
const boostedSummaryPath = required('BEHAVIORAL_V6_BOOSTED_SUMMARY_PATH');
const v3SummaryPath = required('BEHAVIORAL_V6_V3_SUMMARY_PATH');
const outputDirectory = required('BEHAVIORAL_V6_SEQUENCE_SCREEN_OUTPUT_DIR');
const expectedSampleSha256 = requiredSha('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');
const expectedChoiceSetSha256 = requiredSha('EXPECTED_CHOICE_SET_REPORT_SHA256');

const executorVersion = 'MERGED_TOP_96_SEQUENCE_NEURAL_SCREEN_1';
const runtimeExecution = 'STREAMING_GZIP_DECISIONS_1';
const choiceSetDefinition = 'MERGED_TOP_96';
const maximumCandidates = 96;
const modelConfig = {
  historyLength: 16,
  hiddenDimension: 12,
  sequenceEmbeddingHashDimension: 4_096,
  contextEmbeddingHashDimension: 2_048,
  candidateEmbeddingHashDimension: 4_096,
  candidateBiasHashDimension: 8_192,
  recurrenceDecay: 0.8,
};
const trainingConfig = {
  epochs: 3,
  learningRate: 0.03,
  l2: 0,
  gradientClip: 1,
  supportProbability: 0.01,
  propensityFloors: [0.005, 0.01, 0.02],
  majorGroupMinDecisions: 100,
};

await validateInputs();
await mkdir(outputDirectory, { recursive: true });
const model = createRecommendationBehavioralV6SequenceModel(modelConfig);
const trainingEpochs = [];
for (let epoch = 1; epoch <= trainingConfig.epochs; epoch += 1) {
  const result = await trainEpoch(model, epoch);
  validateRecommendationBehavioralV6SequenceModel(model);
  trainingEpochs.push(result);
  console.log(JSON.stringify({ progress: 'TRAIN_EPOCH_COMPLETE', ...result }));
  await tick();
}

const evaluation = await evaluateTuning(model);
const boosted = JSON.parse(await readFile(boostedSummaryPath, 'utf8'));
const v3 = JSON.parse(await readFile(v3SummaryPath, 'utf8'));
const boostedModel = boosted.tuning?.model;
const v3LT = v3.results?.find((value) => value.variant === 'LT')?.tuningMetrics;
if (!boostedModel || !v3LT) throw new Error('Behavioral V6 reference metrics are missing.');
const boostedLateSupport = supportForGroup(boostedModel.groups, 'PHASE:LATE');
const boostedHighEconomySupport = supportForGroup(boostedModel.groups, 'ECONOMY:GE_20000');
const sequenceLateSupport = supportForGroup(evaluation.model.groups, 'PHASE:LATE');
const sequenceHighEconomySupport = supportForGroup(evaluation.model.groups, 'ECONOMY:GE_20000');
const ablatedLateSupport = supportForGroup(evaluation.historyAblated.groups, 'PHASE:LATE');

const continuationChecks = {
  candidateCoverageAtLeast099: evaluation.candidateCoverage >= 0.99,
  supportAtLeast084: evaluation.model.supportCoverage >= 0.84,
  modelSupportBeatsBoostedBy001:
    evaluation.model.supportCoverage >= boostedModel.supportCoverage + 0.01,
  modelRawLogLossBeatsV3LT:
    evaluation.model.rawLogLoss < v3LT.rawLogLoss,
  modelRawLogLossBeatsBoosted:
    evaluation.model.rawLogLoss < boostedModel.rawLogLoss,
  majorLowSupportGroupsAtMost8:
    evaluation.model.majorLowSupportGroupCount <= 8,
  floorSensitivityBelow025:
    evaluation.model.floorSensitivityDelta < 0.25,
  lateSupportBeatsBoostedBy002:
    sequenceLateSupport >= boostedLateSupport + 0.02,
  highEconomySupportBeatsBoostedBy002:
    sequenceHighEconomySupport >= boostedHighEconomySupport + 0.02,
  orderedHistorySignalObserved:
    evaluation.model.rawLogLoss <= evaluation.historyAblated.rawLogLoss - 0.005 ||
    sequenceLateSupport >= ablatedLateSupport + 0.01,
};
const screenPassed = Object.values(continuationChecks).every(Boolean);

const artifact = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_NEURAL_SCREEN_MODEL',
  diagnosticOnly: true,
  trainingArtifactEligible: false,
  choiceSetDefinition,
  executorVersion,
  runtimeExecution,
  modelConfig,
  trainingConfig,
  model,
};
await writeJson(`${outputDirectory}/model.json`, artifact);
const summary = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_NEURAL_SCREEN',
  executorVersion,
  runtimeExecution,
  generatedAt: new Date().toISOString(),
  source: {
    pinnedSampleSha256: expectedSampleSha256,
    choiceSetReportSha256: expectedChoiceSetSha256,
    futureTestRowCount: 0,
  },
  choiceSet: {
    definition: choiceSetDefinition,
    maximumCandidates,
    candidateCoverage: evaluation.candidateCoverage,
    observedActionInjected: false,
    selectedAfterObservedAction: false,
  },
  contracts: {
    modelVersion: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_PROBABILITY_CONTRACT,
    objective: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OBJECTIVE,
    baseScoreContract: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_BASE_SCORE,
    encoderContract: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_ENCODER,
    optimizerContract: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OPTIMIZER,
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
  tuning: evaluation,
  references: {
    boosted: {
      supportCoverage: boostedModel.supportCoverage,
      rawLogLoss: boostedModel.rawLogLoss,
      top1Rate: boostedModel.top1Rate,
      majorLowSupportGroupCount: boostedModel.majorLowSupportGroupCount,
      floorSensitivityDelta: boostedModel.floorSensitivityDelta,
      lateSupportCoverage: boostedLateSupport,
      highEconomySupportCoverage: boostedHighEconomySupport,
    },
    v3LT: {
      supportCoverage: v3LT.supportCoverage,
      rawLogLoss: v3LT.rawLogLoss,
      top1Rate: v3LT.top1Rate,
    },
  },
  continuationChecks,
  screenPassed,
  strictCrossFitRecommended: screenPassed,
  currentFamily: 'SEQUENCE_NEURAL',
  nextFamilyRecommended: screenPassed ? null : 'LATENT_STATE_MIXTURE_OR_STATE_RECONSTRUCTION',
  diagnosticOnly: true,
  trainingArtifactEligible: false,
  fullTrainingAuthorized: false,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};
await writeJson(`${outputDirectory}/screen-summary.json`, summary);
await writeFile(`${outputDirectory}/screen-report.txt`, renderReport(summary), 'utf8');
console.log(JSON.stringify(summary, null, 2));

async function validateInputs() {
  if ((await hashFile(samplePath)) !== expectedSampleSha256) {
    throw new Error('Pinned sample SHA-256 mismatch.');
  }
  if ((await hashFile(choiceSetReportPath)) !== expectedChoiceSetSha256) {
    throw new Error('Frozen choice-set report SHA-256 mismatch.');
  }
  const choice = JSON.parse(await readFile(choiceSetReportPath, 'utf8'));
  const selected = choice.variants?.find((value) => value.id === choiceSetDefinition);
  if (
    choice.trainingPerformed !== false ||
    choice.valueTrainingPerformed !== false ||
    choice.futureTestEvaluated !== false ||
    !selected?.gate?.passed ||
    selected.overall.observedCoverage < 0.99
  ) {
    throw new Error('Frozen Top96 choice-set evidence is not eligible.');
  }
  const boosted = JSON.parse(await readFile(boostedSummaryPath, 'utf8'));
  if (
    boosted.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_GROUPED_BOOSTED_LISTWISE_SCREEN' ||
    boosted.screenPassed !== false ||
    boosted.strictCrossFitRecommended !== false ||
    boosted.nextFamilyRecommended !== 'SEQUENCE_NEURAL' ||
    boosted.source?.futureTestRowCount !== 0 ||
    boosted.trainingArtifactEligible !== false
  ) {
    throw new Error('Boosted-listwise screen does not authorize Sequence Neural screening.');
  }
  const v3 = JSON.parse(await readFile(v3SummaryPath, 'utf8'));
  if (
    v3.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_EQUAL_CAPACITY_ABLATION' ||
    v3.source?.futureTestRowCount !== 0 ||
    v3.choiceSet?.definition !== choiceSetDefinition ||
    v3.anyReleaseEligible !== false
  ) {
    throw new Error('V3 reference summary is not eligible.');
  }
}

async function trainEpoch(model, epoch) {
  let trainDecisionCount = 0;
  let lossSum = 0;
  let futureTestRowCount = 0;
  const input = createInterface({
    input: createReadStream(samplePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
      continue;
    }
    if (row.split !== 'TRAIN' || row.eligibility?.behavioralModel !== true) continue;
    const selected = selectTop96(row);
    if (!selected) continue;
    lossSum += trainRecommendationBehavioralV6SequenceDecision(
      model,
      selected,
      {
        learningRate: trainingConfig.learningRate,
        l2: trainingConfig.l2,
        gradientClip: trainingConfig.gradientClip,
      },
    );
    trainDecisionCount += 1;
    if (trainDecisionCount % 5_000 === 0) {
      console.log(JSON.stringify({
        progress: 'TRAIN_ROWS',
        epoch,
        trainDecisionCount,
        meanOnlineLoss: lossSum / trainDecisionCount,
      }));
      await tick();
    }
  }
  if (futureTestRowCount !== 0) throw new Error(`FUTURE_TEST row count must be zero, got ${futureTestRowCount}.`);
  return {
    epoch,
    trainDecisionCount,
    meanOnlineLoss: lossSum / trainDecisionCount,
    trainedDecisionCount: model.trainedDecisionCount,
  };
}

async function evaluateTuning(model) {
  const modelAccumulator = createAccumulator();
  const ablatedAccumulator = createAccumulator();
  const inverseAccumulator = createAccumulator();
  let selectionRowCount = 0;
  let candidateCoveredSelectionRowCount = 0;
  let tuningDecisionCount = 0;
  let futureTestRowCount = 0;
  const input = createInterface({
    input: createReadStream(samplePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
      continue;
    }
    if (row.split !== 'TRAIN' && row.split !== 'TUNING') continue;
    selectionRowCount += 1;
    const selected = selectTop96(row);
    if (selected) candidateCoveredSelectionRowCount += 1;
    if (!selected || row.split !== 'TUNING' || row.eligibility?.behavioralModel !== true) continue;
    tuningDecisionCount += 1;
    observe(modelAccumulator, selected, predictRecommendationBehavioralV6Sequence(model, selected));
    const ablated = {
      ...selected,
      state: { ...selected.state, previousActionKeys: [] },
    };
    observe(
      ablatedAccumulator,
      ablated,
      predictRecommendationBehavioralV6Sequence(model, ablated),
    );
    observe(inverseAccumulator, selected, inverseRankPrediction(selected));
  }
  if (futureTestRowCount !== 0) throw new Error(`FUTURE_TEST row count must be zero, got ${futureTestRowCount}.`);
  if (tuningDecisionCount === 0) throw new Error('No TUNING decisions were evaluated.');
  return {
    decisionCount: tuningDecisionCount,
    candidateCoverage: divide(candidateCoveredSelectionRowCount, selectionRowCount),
    model: finalizeAccumulator(modelAccumulator),
    historyAblated: finalizeAccumulator(ablatedAccumulator),
    inverseRank: finalizeAccumulator(inverseAccumulator),
  };
}

function selectTop96(row) {
  const observedIndex = row.candidates.findIndex(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  if (observedIndex < 0 || observedIndex >= maximumCandidates) return undefined;
  const candidates = row.candidates.slice(0, maximumCandidates).map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
  }));
  if (candidates.length < 2) return undefined;
  return { ...row, candidates, observedActionInCandidateSet: true };
}

function inverseRankPrediction(row) {
  const weights = row.candidates.map((candidate) => 1 / Math.max(1, candidate.rank));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const candidates = row.candidates.map((candidate, index) => ({
    actionKey: candidate.actionKey,
    probability: weights[index] / total,
  }));
  let top = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (candidate.probability > top.probability) top = candidate;
  }
  return {
    candidates,
    observedActionProbability:
      candidates.find((candidate) => candidate.actionKey === row.observedActionKey)?.probability ?? 0,
    topActionKey: top.actionKey,
  };
}

function createAccumulator() {
  return {
    selection: emptyMetric(),
    groups: new Map(),
    floorLossSums: new Map(trainingConfig.propensityFloors.map((floor) => [floor, 0])),
  };
}

function observe(accumulator, row, prediction) {
  const probability = prediction.observedActionProbability;
  const supported = probability >= trainingConfig.supportProbability;
  const top1 = prediction.topActionKey === row.observedActionKey;
  observeMetric(accumulator.selection, prediction, probability, supported, top1);
  const observedCandidate = row.candidates.find(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  const groupKeys = [
    `HERO:${row.state.heroId}`,
    `PHASE:${row.state.phase}`,
    `TIME:${timeBucket(row.state.gameTimeS)}`,
    `ECONOMY:${economyBand(row.state.netWorth)}`,
    `ACTION:${String(row.observedActionKey).split(':')[0]}`,
    `TIER:${observedCandidate?.tier ?? 'UNKNOWN'}`,
  ];
  for (const key of groupKeys) {
    let group = accumulator.groups.get(key);
    if (!group) {
      group = emptyMetric();
      accumulator.groups.set(key, group);
    }
    observeMetric(group, prediction, probability, supported, top1);
  }
  for (const floor of trainingConfig.propensityFloors) {
    accumulator.floorLossSums.set(
      floor,
      accumulator.floorLossSums.get(floor) - Math.log(Math.max(probability, floor)),
    );
  }
}

function observeMetric(metric, prediction, probability, supported, top1) {
  metric.decisions += 1;
  metric.supported += supported ? 1 : 0;
  metric.top1 += top1 ? 1 : 0;
  metric.loss += -Math.log(Math.max(probability, 1e-15));
  metric.observedProbability += probability;
  metric.minimumObservedProbability = Math.min(metric.minimumObservedProbability, probability);
  for (const candidate of prediction.candidates) {
    metric.candidateCount += 1;
    if (candidate.probability <= 1e-8 || candidate.probability >= 1 - 1e-8) {
      metric.extremeCandidates += 1;
    }
  }
}

function finalizeAccumulator(accumulator) {
  const selection = finalizeMetric(accumulator.selection);
  const groups = [...accumulator.groups.entries()]
    .map(([key, metric]) => ({
      key,
      major: metric.decisions >= trainingConfig.majorGroupMinDecisions,
      ...finalizeMetric(metric),
    }))
    .sort((left, right) => left.key.localeCompare(right.key, undefined, { numeric: true }));
  const majorLowSupportGroups = groups.filter(
    (group) => group.major && group.supportCoverage < 0.75,
  );
  const floors = trainingConfig.propensityFloors.map((floor) => {
    const logLoss = accumulator.floorLossSums.get(floor) / accumulator.selection.decisions;
    return {
      floor,
      logLoss,
      logLossDeltaFromRaw: Math.abs(selection.rawLogLoss - logLoss),
    };
  });
  return {
    ...selection,
    majorLowSupportGroupCount: majorLowSupportGroups.length,
    majorLowSupportGroups,
    floorSensitivityDelta: Math.max(...floors.map((value) => value.logLossDeltaFromRaw)),
    floorSensitivity: floors,
    groups,
  };
}

function emptyMetric() {
  return {
    decisions: 0,
    supported: 0,
    top1: 0,
    loss: 0,
    observedProbability: 0,
    minimumObservedProbability: 1,
    extremeCandidates: 0,
    candidateCount: 0,
  };
}

function finalizeMetric(metric) {
  return {
    decisionCount: metric.decisions,
    supportCoverage: divide(metric.supported, metric.decisions),
    rawLogLoss: divide(metric.loss, metric.decisions),
    top1Rate: divide(metric.top1, metric.decisions),
    meanObservedRawProbability: divide(metric.observedProbability, metric.decisions),
    minimumObservedRawProbability:
      metric.decisions > 0 ? metric.minimumObservedProbability : 0,
    extremeCandidateProbabilityRate: divide(metric.extremeCandidates, metric.candidateCount),
  };
}

function supportForGroup(groups, key) {
  const group = groups?.find((value) => value.key === key);
  if (!group) throw new Error(`Missing required group ${key}.`);
  return group.supportCoverage;
}

function timeBucket(seconds) {
  const start = Math.floor(Number(seconds || 0) / 300) * 5;
  return `${start}-${start + 5}m`;
}

function economyBand(netWorth) {
  const value = Number(netWorth || 0);
  if (value < 5_000) return 'LT_5000';
  if (value < 10_000) return '5000_9999';
  if (value < 15_000) return '10000_14999';
  if (value < 20_000) return '15000_19999';
  return 'GE_20000';
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function requiredSha(name) {
  const value = required(name);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be SHA-256.`);
  return value;
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function renderReport(summary) {
  return [
    'Recommendation Behavioral V6 Sequence Neural Screen',
    `screenPassed=${summary.screenPassed}`,
    `support=${summary.tuning.model.supportCoverage}`,
    `rawLogLoss=${summary.tuning.model.rawLogLoss}`,
    `top1=${summary.tuning.model.top1Rate}`,
    `lateSupport=${supportForGroup(summary.tuning.model.groups, 'PHASE:LATE')}`,
    `historyAblatedRawLogLoss=${summary.tuning.historyAblated.rawLogLoss}`,
    `strictCrossFitRecommended=${summary.strictCrossFitRecommended}`,
    `nextFamilyRecommended=${summary.nextFamilyRecommended ?? 'NONE'}`,
    '',
  ].join('\n');
}
