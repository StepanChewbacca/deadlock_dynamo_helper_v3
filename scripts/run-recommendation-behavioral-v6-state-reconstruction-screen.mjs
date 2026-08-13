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
  recommendationBehavioralV6SequenceContextTokens,
  recommendationBehavioralV6SequenceHistoryTokens,
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
const sequenceSummaryPath = required('BEHAVIORAL_V6_SEQUENCE_SUMMARY_PATH');
const latentDiagnosticPath = required('BEHAVIORAL_V6_LATENT_STATE_DIAGNOSTIC_PATH');
const outputDirectory = required('BEHAVIORAL_V6_STATE_RECONSTRUCTION_OUTPUT_DIR');
const expectedSampleSha256 = requiredSha('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');
const expectedChoiceSetSha256 = requiredSha('EXPECTED_CHOICE_SET_REPORT_SHA256');

const executorVersion = 'MERGED_TOP_96_SEQUENCE_STATE_RECONSTRUCTION_SCREEN_1';
const auxiliaryObjective = 'MASKED_LAST_HISTORY_STATE_RECONSTRUCTION_1';
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
  behaviorLearningRate: 0.025,
  reconstructionLearningRate: 0.01,
  l2: 0,
  gradientClip: 1,
  reconstructionTargetScale: 0.75,
  supportProbability: 0.01,
  propensityFloors: [0.005, 0.01, 0.02],
  majorGroupMinDecisions: 100,
};

await validateInputs();
await mkdir(outputDirectory, { recursive: true });
const sequenceReference = JSON.parse(await readFile(sequenceSummaryPath, 'utf8'));
const referenceModel = sequenceReference.tuning?.model;
if (!referenceModel) throw new Error('Sequence reference metrics are missing.');
const referenceLateSupport = supportForGroup(referenceModel.groups, 'PHASE:LATE');
const referenceHighEconomySupport = supportForGroup(referenceModel.groups, 'ECONOMY:GE_20000');

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
const modelLateSupport = supportForGroup(evaluation.model.groups, 'PHASE:LATE');
const modelHighEconomySupport = supportForGroup(
  evaluation.model.groups,
  'ECONOMY:GE_20000',
);
const reconstructionLossDecreased =
  trainingEpochs.length >= 2 &&
  trainingEpochs[trainingEpochs.length - 1].meanReconstructionLoss <
    trainingEpochs[0].meanReconstructionLoss;

const continuationChecks = {
  candidateCoverageAtLeast099: evaluation.candidateCoverage >= 0.99,
  supportAtLeast084: evaluation.model.supportCoverage >= 0.84,
  supportBeatsSequenceBy002:
    evaluation.model.supportCoverage >= referenceModel.supportCoverage + 0.002,
  rawLogLossBeatsSequence:
    evaluation.model.rawLogLoss < referenceModel.rawLogLoss,
  floorSensitivityBelow028:
    evaluation.model.floorSensitivityDelta < 0.28,
  majorLowSupportGroupsAtMost2:
    evaluation.model.majorLowSupportGroupCount <= 2,
  lateSupportBeatsSequenceBy005:
    modelLateSupport >= referenceLateSupport + 0.005,
  highEconomySupportBeatsSequenceBy005:
    modelHighEconomySupport >= referenceHighEconomySupport + 0.005,
  reconstructionLossDecreased,
};
const screenPassed = Object.values(continuationChecks).every(Boolean);

const artifact = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_STATE_RECONSTRUCTION_SCREEN_MODEL',
  diagnosticOnly: true,
  trainingArtifactEligible: false,
  executorVersion,
  auxiliaryObjective,
  runtimeExecution,
  choiceSetDefinition,
  modelConfig,
  trainingConfig,
  model,
};
await writeJson(`${outputDirectory}/model.json`, artifact);

const summary = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_STATE_RECONSTRUCTION_SCREEN',
  executorVersion,
  auxiliaryObjective,
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
    behaviorObjective: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OBJECTIVE,
    auxiliaryObjective,
    baseScoreContract: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_BASE_SCORE,
    encoderContract: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_ENCODER,
    optimizerContract: RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_OPTIMIZER,
  },
  protocol: {
    reconstructionTarget: 'LAST_PREDECISION_HISTORY_ACTION_TOKEN',
    reconstructionInput: 'CURRENT_PREDECISION_STATE_PLUS_HISTORY_PREFIX',
    reconstructionUsesFutureState: false,
    reconstructionUsesOutcome: false,
    reconstructionUsesCurrentObservedAction: false,
    tuningUsedForTraining: false,
    tuningUsedForEarlyStopping: false,
    crossFittingPerformed: false,
    candidateProbabilityFloorApplied: false,
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
  referenceSequence: {
    supportCoverage: referenceModel.supportCoverage,
    rawLogLoss: referenceModel.rawLogLoss,
    floorSensitivityDelta: referenceModel.floorSensitivityDelta,
    majorLowSupportGroupCount: referenceModel.majorLowSupportGroupCount,
    lateSupportCoverage: referenceLateSupport,
    highEconomySupportCoverage: referenceHighEconomySupport,
  },
  continuationChecks,
  screenPassed,
  strictCrossFitRecommended: screenPassed,
  currentFamily: 'SEQUENCE_STATE_RECONSTRUCTION',
  nextStep: screenPassed
    ? 'STRICT_SEQUENCE_STATE_RECONSTRUCTION_CROSSFIT'
    : 'DOCUMENT_OBSERVABILITY_SUPPORT_CEILING',
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
  const sequence = JSON.parse(await readFile(sequenceSummaryPath, 'utf8'));
  if (
    sequence.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_NEURAL_SCREEN' ||
    sequence.source?.futureTestRowCount !== 0 ||
    sequence.screenPassed !== false ||
    sequence.strictCrossFitRecommended !== false ||
    sequence.continuationChecks?.orderedHistorySignalObserved !== true ||
    sequence.trainingArtifactEligible !== false
  ) {
    throw new Error('Sequence screen does not authorize reconstruction falsification.');
  }
  const latent = JSON.parse(await readFile(latentDiagnosticPath, 'utf8'));
  if (
    latent.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_LATENT_STATE_REGIME_DIAGNOSTIC' ||
    latent.source?.futureTestRowCount !== 0 ||
    latent.latentStateSignalSupported !== false ||
    latent.boundedLatentMixtureScreenRecommended !== false ||
    latent.nextStep !== 'DOCUMENT_OBSERVABILITY_SUPPORT_CEILING' ||
    latent.trainingPerformed !== false ||
    latent.valueTrainingPerformed !== false
  ) {
    throw new Error('Latent-state diagnostic does not authorize reconstruction fallback.');
  }
}

async function trainEpoch(model, epoch) {
  let trainDecisionCount = 0;
  let reconstructionDecisionCount = 0;
  let behaviorLossSum = 0;
  let reconstructionLossSum = 0;
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
    const reconstruction = trainMaskedHistoryReconstruction(model, selected);
    if (reconstruction.applied) {
      reconstructionDecisionCount += 1;
      reconstructionLossSum += reconstruction.loss;
    }
    behaviorLossSum += trainRecommendationBehavioralV6SequenceDecision(
      model,
      selected,
      {
        learningRate: trainingConfig.behaviorLearningRate,
        l2: trainingConfig.l2,
        gradientClip: trainingConfig.gradientClip,
      },
    );
    trainDecisionCount += 1;
    if (trainDecisionCount % 5_000 === 0) {
      console.log(
        JSON.stringify({
          progress: 'TRAIN_ROWS',
          epoch,
          trainDecisionCount,
          reconstructionDecisionCount,
          meanBehaviorLoss: behaviorLossSum / trainDecisionCount,
          meanReconstructionLoss:
            reconstructionDecisionCount > 0
              ? reconstructionLossSum / reconstructionDecisionCount
              : 0,
        }),
      );
      await tick();
    }
  }
  if (futureTestRowCount !== 0) {
    throw new Error(`FUTURE_TEST row count must be zero, got ${futureTestRowCount}.`);
  }
  if (trainDecisionCount === 0 || reconstructionDecisionCount === 0) {
    throw new Error('State reconstruction TRAIN rows are missing.');
  }
  return {
    epoch,
    trainDecisionCount,
    reconstructionDecisionCount,
    meanBehaviorLoss: behaviorLossSum / trainDecisionCount,
    meanReconstructionLoss:
      reconstructionLossSum / reconstructionDecisionCount,
    trainedDecisionCount: model.trainedDecisionCount,
  };
}

function trainMaskedHistoryReconstruction(model, row) {
  const history = row.state.previousActionKeys;
  if (!Array.isArray(history) || history.length < 2) {
    return { applied: false, loss: 0 };
  }
  const maskedToken = history[history.length - 1];
  const maskedRow = {
    ...row,
    state: {
      ...row.state,
      previousActionKeys: history.slice(0, history.length - 1),
    },
  };
  const forward = forwardEncoder(model, maskedRow);
  const target = reconstructionTarget(maskedToken, model.hiddenDimension);
  const gradient = new Array(model.hiddenDimension).fill(0);
  let loss = 0;
  for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
    const difference = target[dimension] - forward.finalHidden[dimension];
    loss += 0.5 * difference * difference;
    gradient[dimension] = difference;
  }
  backpropagateReconstruction(model, forward, gradient);
  return { applied: true, loss: loss / model.hiddenDimension };
}

function forwardEncoder(model, row) {
  const contextTokens = recommendationBehavioralV6SequenceContextTokens(row);
  const sequenceTokens = recommendationBehavioralV6SequenceHistoryTokens(model, row);
  const hidden = new Array(model.hiddenDimension).fill(0);
  for (const token of contextTokens) {
    const offset = contextBucket(model, token) * model.hiddenDimension;
    for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
      hidden[dimension] += model.contextEmbeddings[offset + dimension] / contextTokens.length;
    }
  }
  for (let dimension = 0; dimension < hidden.length; dimension += 1) {
    hidden[dimension] = Math.tanh(hidden[dimension]);
  }
  const hiddenStates = [hidden.slice()];
  for (let index = 0; index < sequenceTokens.length; index += 1) {
    const token = sequenceTokens[index];
    const sequenceOffset = sequenceBucket(model, token) * model.hiddenDimension;
    const position = model.historyLength - sequenceTokens.length + index;
    const positionOffset = position * model.hiddenDimension;
    const previous = hiddenStates[hiddenStates.length - 1];
    const next = new Array(model.hiddenDimension);
    for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
      next[dimension] = Math.tanh(
        model.recurrenceDecay * previous[dimension] +
          model.sequenceEmbeddings[sequenceOffset + dimension] +
          model.positionEmbeddings[positionOffset + dimension],
      );
    }
    hiddenStates.push(next);
  }
  return {
    hiddenStates,
    contextTokens,
    sequenceTokens,
    finalHidden: hiddenStates[hiddenStates.length - 1],
  };
}

function backpropagateReconstruction(model, forward, finalHiddenGradient) {
  let hiddenGradient = finalHiddenGradient.slice();
  for (let index = forward.sequenceTokens.length - 1; index >= 0; index -= 1) {
    const currentHidden = forward.hiddenStates[index + 1];
    const token = forward.sequenceTokens[index];
    const sequenceOffset = sequenceBucket(model, token) * model.hiddenDimension;
    const position = model.historyLength - forward.sequenceTokens.length + index;
    const positionOffset = position * model.hiddenDimension;
    const previousGradient = new Array(model.hiddenDimension).fill(0);
    for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
      const localGradient =
        hiddenGradient[dimension] * (1 - currentHidden[dimension] ** 2);
      model.sequenceEmbeddings[sequenceOffset + dimension] +=
        trainingConfig.reconstructionLearningRate *
        clip(localGradient, trainingConfig.gradientClip);
      model.positionEmbeddings[positionOffset + dimension] +=
        trainingConfig.reconstructionLearningRate *
        clip(localGradient, trainingConfig.gradientClip);
      previousGradient[dimension] = model.recurrenceDecay * localGradient;
    }
    hiddenGradient = previousGradient;
  }
  const initialHidden = forward.hiddenStates[0];
  const contextScale = Math.max(1, forward.contextTokens.length);
  for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
    hiddenGradient[dimension] *= 1 - initialHidden[dimension] ** 2;
  }
  for (const token of forward.contextTokens) {
    const offset = contextBucket(model, token) * model.hiddenDimension;
    for (let dimension = 0; dimension < model.hiddenDimension; dimension += 1) {
      model.contextEmbeddings[offset + dimension] +=
        trainingConfig.reconstructionLearningRate *
        clip(hiddenGradient[dimension] / contextScale, trainingConfig.gradientClip);
    }
  }
}

function reconstructionTarget(token, hiddenDimension) {
  return Array.from({ length: hiddenDimension }, (_, dimension) => {
    const hash = fnv1a32(`RECON:${token}:${dimension}`);
    const normalized = ((hash & 0xffff) / 0xffff) * 2 - 1;
    return normalized * trainingConfig.reconstructionTargetScale;
  });
}

async function evaluateTuning(model) {
  const modelAccumulator = createAccumulator();
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
    if (
      !selected ||
      row.split !== 'TUNING' ||
      row.eligibility?.behavioralModel !== true
    ) {
      continue;
    }
    tuningDecisionCount += 1;
    observe(
      modelAccumulator,
      selected,
      predictRecommendationBehavioralV6Sequence(model, selected),
    );
  }
  if (futureTestRowCount !== 0) {
    throw new Error(`FUTURE_TEST row count must be zero, got ${futureTestRowCount}.`);
  }
  if (tuningDecisionCount === 0) throw new Error('No TUNING decisions were evaluated.');
  return {
    decisionCount: tuningDecisionCount,
    candidateCoverage: divide(
      candidateCoveredSelectionRowCount,
      selectionRowCount,
    ),
    model: finalizeAccumulator(modelAccumulator),
  };
}

function selectTop96(row) {
  const observedIndex = row.candidates.findIndex(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  if (observedIndex < 0 || observedIndex >= maximumCandidates) return undefined;
  const candidates = row.candidates
    .slice(0, maximumCandidates)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  if (candidates.length < 2) return undefined;
  return { ...row, candidates, observedActionInCandidateSet: true };
}

function createAccumulator() {
  return {
    selection: emptyMetric(),
    groups: new Map(),
    floorLossSums: new Map(
      trainingConfig.propensityFloors.map((floor) => [floor, 0]),
    ),
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
      accumulator.floorLossSums.get(floor) -
        Math.log(Math.max(probability, floor)),
    );
  }
}

function observeMetric(metric, prediction, probability, supported, top1) {
  metric.decisions += 1;
  metric.supported += supported ? 1 : 0;
  metric.top1 += top1 ? 1 : 0;
  metric.loss += -Math.log(Math.max(probability, 1e-15));
  metric.observedProbability += probability;
  metric.minimumObservedProbability = Math.min(
    metric.minimumObservedProbability,
    probability,
  );
  for (const candidate of prediction.candidates) {
    metric.candidateCount += 1;
    if (
      candidate.probability <= 1e-8 ||
      candidate.probability >= 1 - 1e-8
    ) {
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
    .sort((left, right) =>
      left.key.localeCompare(right.key, undefined, { numeric: true }),
    );
  const majorLowSupportGroups = groups.filter(
    (group) => group.major && group.supportCoverage < 0.75,
  );
  const floors = trainingConfig.propensityFloors.map((floor) => {
    const logLoss =
      accumulator.floorLossSums.get(floor) / accumulator.selection.decisions;
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
    floorSensitivityDelta: Math.max(
      ...floors.map((value) => value.logLossDeltaFromRaw),
    ),
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
    meanObservedRawProbability: divide(
      metric.observedProbability,
      metric.decisions,
    ),
    minimumObservedRawProbability:
      metric.decisions > 0 ? metric.minimumObservedProbability : 0,
    extremeCandidateProbabilityRate: divide(
      metric.extremeCandidates,
      metric.candidateCount,
    ),
  };
}

function sequenceBucket(model, token) {
  return fnv1a32(`SEQ:${token}`) % model.sequenceEmbeddingHashDimension;
}

function contextBucket(model, token) {
  return fnv1a32(`CTX:${token}`) % model.contextEmbeddingHashDimension;
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clip(value, maximumAbsoluteValue) {
  return Math.max(
    -maximumAbsoluteValue,
    Math.min(maximumAbsoluteValue, value),
  );
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
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be SHA-256.`);
  }
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
    'Recommendation Behavioral V6 Sequence State Reconstruction Screen',
    `screenPassed=${summary.screenPassed}`,
    `support=${summary.tuning.model.supportCoverage}`,
    `rawLogLoss=${summary.tuning.model.rawLogLoss}`,
    `floorSensitivity=${summary.tuning.model.floorSensitivityDelta}`,
    `lateSupport=${supportForGroup(summary.tuning.model.groups, 'PHASE:LATE')}`,
    `highEconomySupport=${supportForGroup(summary.tuning.model.groups, 'ECONOMY:GE_20000')}`,
    `strictCrossFitRecommended=${summary.strictCrossFitRecommended}`,
    `nextStep=${summary.nextStep}`,
    '',
  ].join('\n');
}
