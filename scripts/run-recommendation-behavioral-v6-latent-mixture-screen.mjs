import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const require = createRequire(import.meta.url);
const {
  createRecommendationBehavioralV6LatentMixtureModel,
  predictRecommendationBehavioralV6LatentMixture,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_EXPERT_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_FEATURE_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_GATE_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OBJECTIVE,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OPTIMIZER,
  RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_PROBABILITY_CONTRACT,
  trainRecommendationBehavioralV6LatentMixtureDecision,
  validateRecommendationBehavioralV6LatentMixtureModel,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v6-latent-mixture.js');
const {
  predictRecommendationBehavioralV6Sequence,
  validateRecommendationBehavioralV6SequenceModel,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v6-sequence-neural.js');

const samplePath = required('BEHAVIORAL_V6_SAMPLE_PATH');
const choiceSetReportPath = required('BEHAVIORAL_V6_CHOICE_SET_REPORT_PATH');
const diagnosticPath = required('BEHAVIORAL_V6_LATENT_STATE_DIAGNOSTIC_PATH');
const sequenceModelPath = required('BEHAVIORAL_V6_SEQUENCE_MODEL_PATH');
const sequenceSummaryPath = required('BEHAVIORAL_V6_SEQUENCE_SUMMARY_PATH');
const outputDirectory = required('BEHAVIORAL_V6_LATENT_MIXTURE_OUTPUT_DIR');
const expectedSampleSha256 = requiredSha('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');
const expectedChoiceSetSha256 = requiredSha('EXPECTED_CHOICE_SET_REPORT_SHA256');

const executorVersion = 'MERGED_TOP_96_LATENT_STATE_MIXTURE_SCREEN_1';
const maximumCandidates = 96;
const modelConfig = {
  expertCount: 4,
  historyLength: 8,
  gateHashDimension: 4_096,
  candidateBiasHashDimension: 8_192,
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
const sequenceArtifact = JSON.parse(await readFile(sequenceModelPath, 'utf8'));
const sequenceModel = sequenceArtifact.model;
validateRecommendationBehavioralV6SequenceModel(sequenceModel);
const sequenceSummary = JSON.parse(await readFile(sequenceSummaryPath, 'utf8'));
const sequenceReference = sequenceSummary.tuning.model;
const model = createRecommendationBehavioralV6LatentMixtureModel(modelConfig);
const epochs = [];
for (let epoch = 1; epoch <= trainingConfig.epochs; epoch += 1) {
  const result = await trainEpoch(model, epoch);
  validateRecommendationBehavioralV6LatentMixtureModel(model);
  epochs.push(result);
  console.log(JSON.stringify({ progress: 'TRAIN_EPOCH_COMPLETE', ...result }));
  await tick();
}

const evaluation = await evaluateTuning(model, sequenceModel);
const mixtureLate = supportForGroup(evaluation.model.groups, 'PHASE:LATE');
const sequenceLate = supportForGroup(evaluation.sequence.groups, 'PHASE:LATE');
const mixtureHighEconomy = supportForGroup(
  evaluation.model.groups,
  'ECONOMY:GE_20000',
);
const sequenceHighEconomy = supportForGroup(
  evaluation.sequence.groups,
  'ECONOMY:GE_20000',
);
const ablatedLate = supportForGroup(
  evaluation.historyAblatedGate.groups,
  'PHASE:LATE',
);
const continuationChecks = {
  candidateCoverageAtLeast099: evaluation.candidateCoverage >= 0.99,
  supportAtLeast085: evaluation.model.supportCoverage >= 0.85,
  supportBeatsSequenceBy0005:
    evaluation.model.supportCoverage >= evaluation.sequence.supportCoverage + 0.005,
  rawLogLossBeatsSequence:
    evaluation.model.rawLogLoss < evaluation.sequence.rawLogLoss,
  floorSensitivityAtMost025:
    evaluation.model.floorSensitivityDelta <= 0.25,
  majorLowSupportGroupsAtMost1:
    evaluation.model.majorLowSupportGroupCount <= 1,
  lateSupportBeatsSequenceBy001:
    mixtureLate >= sequenceLate + 0.01,
  highEconomySupportBeatsSequenceBy001:
    mixtureHighEconomy >= sequenceHighEconomy + 0.01,
  latentGateSignalObserved:
    evaluation.model.rawLogLoss <= evaluation.historyAblatedGate.rawLogLoss - 0.005 ||
    mixtureLate >= ablatedLate + 0.01,
};
const screenPassed = Object.values(continuationChecks).every(Boolean);

const modelArtifact = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_LATENT_STATE_MIXTURE_SCREEN_MODEL',
  diagnosticOnly: true,
  trainingArtifactEligible: false,
  choiceSetDefinition: 'MERGED_TOP_96',
  executorVersion,
  modelConfig,
  trainingConfig,
  model,
};
await writeJson(`${outputDirectory}/model.json`, modelArtifact);
const summary = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_LATENT_STATE_MIXTURE_SCREEN',
  executorVersion,
  generatedAt: new Date().toISOString(),
  source: {
    pinnedSampleSha256: expectedSampleSha256,
    choiceSetReportSha256: expectedChoiceSetSha256,
    futureTestRowCount: 0,
  },
  choiceSet: {
    definition: 'MERGED_TOP_96',
    maximumCandidates,
    candidateCoverage: evaluation.candidateCoverage,
    observedActionInjected: false,
    selectedAfterObservedAction: false,
  },
  contracts: {
    modelVersion: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_PROBABILITY_CONTRACT,
    objective: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OBJECTIVE,
    gateContract: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_GATE_CONTRACT,
    expertContract: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_EXPERT_CONTRACT,
    optimizerContract: RECOMMENDATION_BEHAVIORAL_V6_LATENT_MIXTURE_OPTIMIZER,
  },
  modelConfig,
  trainingConfig,
  training: {
    epochs,
    tuningUsedForTraining: false,
    tuningUsedForEarlyStopping: false,
    crossFittingPerformed: false,
    rowsMaterializedInHeap: false,
  },
  diagnosticAuthorization: {
    latentStateSignalSupported: true,
    diagnosticPath,
  },
  tuning: evaluation,
  sequenceReference: {
    supportCoverage: sequenceReference.supportCoverage,
    rawLogLoss: sequenceReference.rawLogLoss,
    top1Rate: sequenceReference.top1Rate,
    floorSensitivityDelta: sequenceReference.floorSensitivityDelta,
    majorLowSupportGroupCount: sequenceReference.majorLowSupportGroupCount,
  },
  cohortComparison: {
    mixtureLateSupport: mixtureLate,
    sequenceLateSupport: sequenceLate,
    mixtureHighEconomySupport: mixtureHighEconomy,
    sequenceHighEconomySupport: sequenceHighEconomy,
    historyAblatedLateSupport: ablatedLate,
  },
  continuationChecks,
  screenPassed,
  strictCrossFitRecommended: screenPassed,
  currentFamily: 'LATENT_STATE_MIXTURE',
  nextStep: screenPassed
    ? 'STRICT_MATCH_CROSSFIT_LATENT_STATE_MIXTURE'
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
await writeFile(`${outputDirectory}/screen-report.txt`, renderReport(summary), 'utf8');
console.log(JSON.stringify(summary, null, 2));

async function validateInputs() {
  if ((await hashFile(samplePath)) !== expectedSampleSha256) {
    throw new Error('Pinned sample SHA-256 mismatch.');
  }
  if ((await hashFile(choiceSetReportPath)) !== expectedChoiceSetSha256) {
    throw new Error('Frozen choice-set report SHA-256 mismatch.');
  }
  const choiceSet = JSON.parse(await readFile(choiceSetReportPath, 'utf8'));
  const selectedChoice = choiceSet.variants?.find((value) => value.id === 'MERGED_TOP_96');
  if (
    choiceSet.trainingPerformed !== false ||
    choiceSet.valueTrainingPerformed !== false ||
    choiceSet.futureTestEvaluated !== false ||
    !selectedChoice?.gate?.passed ||
    selectedChoice.overall.observedCoverage < 0.99
  ) {
    throw new Error('Frozen Top96 choice-set evidence is not eligible.');
  }
  const diagnostic = JSON.parse(await readFile(diagnosticPath, 'utf8'));
  if (
    diagnostic.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_LATENT_STATE_REGIME_DIAGNOSTIC' ||
    diagnostic.source?.futureTestRowCount !== 0 ||
    diagnostic.protocol?.assignmentUsesObservedAction !== false ||
    diagnostic.protocol?.assignmentUsesOutcome !== false ||
    diagnostic.protocol?.assignmentUsesFutureState !== false ||
    diagnostic.latentStateSignalSupported !== true ||
    diagnostic.boundedLatentMixtureScreenRecommended !== true ||
    diagnostic.trainingPerformed !== false ||
    diagnostic.valueTrainingPerformed !== false
  ) {
    throw new Error('Latent-state diagnostic does not authorize mixture screening.');
  }
  const sequenceArtifact = JSON.parse(await readFile(sequenceModelPath, 'utf8'));
  const summary = JSON.parse(await readFile(sequenceSummaryPath, 'utf8'));
  if (
    sequenceArtifact.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_NEURAL_SCREEN_MODEL' ||
    sequenceArtifact.trainingArtifactEligible !== false ||
    summary.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_NEURAL_SCREEN' ||
    summary.source?.futureTestRowCount !== 0 ||
    summary.training?.tuningUsedForTraining !== false ||
    summary.training?.tuningUsedForEarlyStopping !== false ||
    summary.continuationChecks?.orderedHistorySignalObserved !== true ||
    summary.trainingArtifactEligible !== false
  ) {
    throw new Error('Sequence reference evidence is invalid.');
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
    lossSum += trainRecommendationBehavioralV6LatentMixtureDecision(
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
  if (futureTestRowCount !== 0) {
    throw new Error(`FUTURE_TEST row count must be zero, got ${futureTestRowCount}.`);
  }
  return {
    epoch,
    trainDecisionCount,
    meanOnlineLoss: lossSum / trainDecisionCount,
    trainedDecisionCount: model.trainedDecisionCount,
  };
}

async function evaluateTuning(model, sequenceModel) {
  const modelAccumulator = createAccumulator();
  const ablatedAccumulator = createAccumulator();
  const sequenceAccumulator = createAccumulator();
  let selectionRowCount = 0;
  let coveredSelectionRowCount = 0;
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
    if (selected) coveredSelectionRowCount += 1;
    if (!selected || row.split !== 'TUNING' || row.eligibility?.behavioralModel !== true) continue;
    tuningDecisionCount += 1;
    observe(
      modelAccumulator,
      selected,
      predictRecommendationBehavioralV6LatentMixture(model, selected),
    );
    const historyAblated = {
      ...selected,
      state: { ...selected.state, previousActionKeys: [] },
    };
    observe(
      ablatedAccumulator,
      historyAblated,
      predictRecommendationBehavioralV6LatentMixture(model, historyAblated),
    );
    observe(
      sequenceAccumulator,
      selected,
      predictRecommendationBehavioralV6Sequence(sequenceModel, selected),
    );
  }
  if (futureTestRowCount !== 0) {
    throw new Error(`FUTURE_TEST row count must be zero, got ${futureTestRowCount}.`);
  }
  if (tuningDecisionCount === 0) throw new Error('No TUNING rows were evaluated.');
  return {
    decisionCount: tuningDecisionCount,
    candidateCoverage: divide(coveredSelectionRowCount, selectionRowCount),
    model: finalizeAccumulator(modelAccumulator),
    historyAblatedGate: finalizeAccumulator(ablatedAccumulator),
    sequence: finalizeAccumulator(sequenceAccumulator),
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
  const group = groups.find((value) => value.key === key);
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
    'Recommendation Behavioral V6 Latent State Mixture Screen',
    `screenPassed=${summary.screenPassed}`,
    `support=${summary.tuning.model.supportCoverage}`,
    `rawLogLoss=${summary.tuning.model.rawLogLoss}`,
    `floorSensitivity=${summary.tuning.model.floorSensitivityDelta}`,
    `majorLowSupportGroups=${summary.tuning.model.majorLowSupportGroupCount}`,
    `strictCrossFitRecommended=${summary.strictCrossFitRecommended}`,
    `nextStep=${summary.nextStep}`,
    '',
  ].join('\n');
}
