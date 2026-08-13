import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const require = createRequire(import.meta.url);
const {
  predictRecommendationBehavioralV6Sequence,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_PROBABILITY_CONTRACT,
  validateRecommendationBehavioralV6SequenceModel,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v6-sequence-neural.js');

const samplePath = required('BEHAVIORAL_V6_SAMPLE_PATH');
const sequenceModelPath = required('BEHAVIORAL_V6_SEQUENCE_MODEL_PATH');
const sequenceSummaryPath = required('BEHAVIORAL_V6_SEQUENCE_SUMMARY_PATH');
const boostedSummaryPath = required('BEHAVIORAL_V6_BOOSTED_SUMMARY_PATH');
const v3SummaryPath = required('BEHAVIORAL_V6_V3_SUMMARY_PATH');
const reportPath = required('BEHAVIORAL_V6_SEQUENCE_TEMPERATURE_REPORT_PATH');
const expectedSampleSha256 = requiredSha('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');

const executorVersion = 'TUNING_MATCH_SPLIT_TEMPERATURE_CALIBRATION_1';
const temperatures = [1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5];
const supportProbability = 0.01;
const propensityFloors = [0.005, 0.01, 0.02];
const majorGroupMinDecisions = 100;
const maximumCandidates = 96;

if ((await hashFile(samplePath)) !== expectedSampleSha256) {
  throw new Error('Pinned sample SHA-256 mismatch.');
}
const modelArtifact = JSON.parse(await readFile(sequenceModelPath, 'utf8'));
const sequenceSummary = JSON.parse(await readFile(sequenceSummaryPath, 'utf8'));
const boostedSummary = JSON.parse(await readFile(boostedSummaryPath, 'utf8'));
const v3Summary = JSON.parse(await readFile(v3SummaryPath, 'utf8'));
validateInputs(modelArtifact, sequenceSummary, boostedSummary, v3Summary);
const model = modelArtifact.model;
validateRecommendationBehavioralV6SequenceModel(model);

const calibrationAccumulators = new Map(temperatures.map((temperature) => [temperature, createAccumulator()]));
const validationAccumulators = new Map(temperatures.map((temperature) => [temperature, createAccumulator()]));
let calibrationDecisionCount = 0;
let validationDecisionCount = 0;
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
  if (row.split !== 'TUNING' || row.eligibility?.behavioralModel !== true) continue;
  const selected = selectTop96(row);
  if (!selected) continue;
  const prediction = predictRecommendationBehavioralV6Sequence(model, selected);
  const partition = tuningPartition(selected.matchId);
  const accumulators = partition === 'CALIBRATION' ? calibrationAccumulators : validationAccumulators;
  if (partition === 'CALIBRATION') calibrationDecisionCount += 1;
  else validationDecisionCount += 1;
  for (const temperature of temperatures) {
    observe(
      accumulators.get(temperature),
      selected,
      temperaturePrediction(prediction, selected.observedActionKey, temperature),
    );
  }
}
if (futureTestRowCount !== 0) throw new Error(`FUTURE_TEST row count must be zero, got ${futureTestRowCount}.`);
if (calibrationDecisionCount < 2_000 || validationDecisionCount < 2_000) {
  throw new Error('Temperature calibration requires at least 2,000 decisions in each TUNING partition.');
}

const calibration = temperatures.map((temperature) => ({
  temperature,
  metrics: finalizeAccumulator(calibrationAccumulators.get(temperature)),
}));
const validation = temperatures.map((temperature) => ({
  temperature,
  metrics: finalizeAccumulator(validationAccumulators.get(temperature)),
}));
const selectedCalibration = [...calibration].sort(compareCalibrationCandidates)[0];
const selectedValidation = validation.find(
  (value) => value.temperature === selectedCalibration.temperature,
);
const uncalibratedValidation = validation.find((value) => value.temperature === 1);
const boosted = boostedSummary.tuning.model;
const v3LT = v3Summary.results.find((value) => value.variant === 'LT').tuningMetrics;
const selectedLate = supportForGroup(selectedValidation.metrics.groups, 'PHASE:LATE');
const selectedHighEconomy = supportForGroup(selectedValidation.metrics.groups, 'ECONOMY:GE_20000');
const uncalibratedLate = supportForGroup(uncalibratedValidation.metrics.groups, 'PHASE:LATE');
const uncalibratedHighEconomy = supportForGroup(uncalibratedValidation.metrics.groups, 'ECONOMY:GE_20000');

const validationChecks = {
  selectedTemperatureAboveOne: selectedCalibration.temperature > 1,
  supportAtLeast084: selectedValidation.metrics.supportCoverage >= 0.84,
  rawLogLossBeatsV3LT: selectedValidation.metrics.rawLogLoss < v3LT.rawLogLoss,
  rawLogLossBeatsBoosted: selectedValidation.metrics.rawLogLoss < boosted.rawLogLoss,
  floorSensitivityAtMost025: selectedValidation.metrics.floorSensitivityDelta <= 0.25,
  majorLowSupportGroupsAtMost8: selectedValidation.metrics.majorLowSupportGroupCount <= 8,
  supportNotWorseThanUncalibrated:
    selectedValidation.metrics.supportCoverage >= uncalibratedValidation.metrics.supportCoverage,
  lateSupportNotWorseThanUncalibrated: selectedLate >= uncalibratedLate,
  highEconomySupportNotWorseThanUncalibrated: selectedHighEconomy >= uncalibratedHighEconomy,
};
const calibrationSalvageRecommended = Object.values(validationChecks).every(Boolean);
const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_TEMPERATURE_CALIBRATION',
  executorVersion,
  generatedAt: new Date().toISOString(),
  source: {
    pinnedSampleSha256: expectedSampleSha256,
    futureTestRowCount,
    sequenceModelVersion: model.modelVersion,
    probabilityContract: model.probabilityContract,
    sequenceScreenPassed: sequenceSummary.screenPassed,
    orderedHistorySignalObserved: sequenceSummary.continuationChecks.orderedHistorySignalObserved,
  },
  protocol: {
    tuningPartitionUnit: 'MATCH',
    tuningPartitionHash: 'FNV1A_32_MOD_2',
    calibrationRemainder: 0,
    validationRemainder: 1,
    calibrationDecisionCount,
    validationDecisionCount,
    temperatures,
    selectionRule: [
      'supportCoverage >= 0.84 DESC',
      'floorSensitivityDelta <= 0.25 DESC',
      'rawLogLoss ASC',
      'majorLowSupportGroupCount ASC',
      'temperature ASC',
    ],
    candidateProbabilityFloorApplied: false,
    temperatureAppliedInsideRawSoftmax: true,
    modelWeightsChanged: false,
  },
  calibration,
  selectedTemperature: selectedCalibration.temperature,
  selectedCalibrationMetrics: selectedCalibration.metrics,
  selectedValidationMetrics: selectedValidation.metrics,
  uncalibratedValidationMetrics: uncalibratedValidation.metrics,
  references: {
    boosted: {
      supportCoverage: boosted.supportCoverage,
      rawLogLoss: boosted.rawLogLoss,
      floorSensitivityDelta: boosted.floorSensitivityDelta,
    },
    v3LT: {
      supportCoverage: v3LT.supportCoverage,
      rawLogLoss: v3LT.rawLogLoss,
    },
  },
  cohortComparison: {
    selectedLateSupport: selectedLate,
    uncalibratedLateSupport: uncalibratedLate,
    selectedHighEconomySupport: selectedHighEconomy,
    uncalibratedHighEconomySupport: uncalibratedHighEconomy,
  },
  validationChecks,
  calibrationSalvageRecommended,
  strictSequenceCrossFitRecommended: calibrationSalvageRecommended,
  nextFamilyRecommended: calibrationSalvageRecommended
    ? null
    : 'LATENT_STATE_MIXTURE_OR_STATE_RECONSTRUCTION',
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  fullTrainingAuthorized: false,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

function validateInputs(modelArtifact, sequenceSummary, boostedSummary, v3Summary) {
  if (
    modelArtifact.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_NEURAL_SCREEN_MODEL' ||
    modelArtifact.diagnosticOnly !== true ||
    modelArtifact.trainingArtifactEligible !== false ||
    modelArtifact.choiceSetDefinition !== 'MERGED_TOP_96' ||
    modelArtifact.model?.modelVersion !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_MODEL_VERSION ||
    modelArtifact.model?.probabilityContract !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_PROBABILITY_CONTRACT
  ) {
    throw new Error('Sequence screen model artifact is not eligible for calibration diagnostics.');
  }
  if (
    sequenceSummary.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_NEURAL_SCREEN' ||
    sequenceSummary.source?.futureTestRowCount !== 0 ||
    sequenceSummary.training?.tuningUsedForTraining !== false ||
    sequenceSummary.training?.tuningUsedForEarlyStopping !== false ||
    sequenceSummary.screenPassed !== false ||
    sequenceSummary.continuationChecks?.orderedHistorySignalObserved !== true ||
    sequenceSummary.trainingArtifactEligible !== false
  ) {
    throw new Error('Sequence screen summary is not eligible for calibration diagnostics.');
  }
  if (
    boostedSummary.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_GROUPED_BOOSTED_LISTWISE_SCREEN' ||
    boostedSummary.source?.futureTestRowCount !== 0
  ) {
    throw new Error('Boosted reference is invalid.');
  }
  if (
    v3Summary.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_EQUAL_CAPACITY_ABLATION' ||
    v3Summary.source?.futureTestRowCount !== 0
  ) {
    throw new Error('V3 reference is invalid.');
  }
}

function tuningPartition(matchId) {
  return fnv1a32(String(matchId)) % 2 === 0 ? 'CALIBRATION' : 'VALIDATION';
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

function temperaturePrediction(prediction, observedActionKey, temperature) {
  const maximum = Math.max(...prediction.candidates.map((candidate) => candidate.score / temperature));
  const weights = prediction.candidates.map((candidate) =>
    Math.exp(candidate.score / temperature - maximum),
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  const candidates = prediction.candidates.map((candidate, index) => ({
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
      candidates.find((candidate) => candidate.actionKey === observedActionKey)?.probability ?? 0,
    topActionKey: top.actionKey,
  };
}

function compareCalibrationCandidates(left, right) {
  return (
    Number(right.metrics.supportCoverage >= 0.84) - Number(left.metrics.supportCoverage >= 0.84) ||
    Number(right.metrics.floorSensitivityDelta <= 0.25) - Number(left.metrics.floorSensitivityDelta <= 0.25) ||
    left.metrics.rawLogLoss - right.metrics.rawLogLoss ||
    left.metrics.majorLowSupportGroupCount - right.metrics.majorLowSupportGroupCount ||
    left.temperature - right.temperature
  );
}

function createAccumulator() {
  return {
    selection: emptyMetric(),
    groups: new Map(),
    floorLossSums: new Map(propensityFloors.map((floor) => [floor, 0])),
  };
}

function observe(accumulator, row, prediction) {
  const probability = prediction.observedActionProbability;
  const supported = probability >= supportProbability;
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
  for (const floor of propensityFloors) {
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
      major: metric.decisions >= majorGroupMinDecisions,
      ...finalizeMetric(metric),
    }))
    .sort((left, right) => left.key.localeCompare(right.key, undefined, { numeric: true }));
  const majorLowSupportGroups = groups.filter(
    (group) => group.major && group.supportCoverage < 0.75,
  );
  const floors = propensityFloors.map((floor) => {
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

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
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
