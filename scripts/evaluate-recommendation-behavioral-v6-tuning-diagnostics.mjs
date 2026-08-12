import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const require = createRequire(import.meta.url);
const {
  predictRecommendationBehavioralV6,
  validateRecommendationBehavioralV6Model,
  RECOMMENDATION_BEHAVIORAL_V6_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_PROBABILITY_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V6_OPTIMIZER_CONTRACT,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v6.js');

const samplePath = required('BEHAVIORAL_V6_SAMPLE_PATH');
const ablationDirectory = required('BEHAVIORAL_V6_ABLATION_DIR');
const reportPath = required('BEHAVIORAL_V6_TUNING_DIAGNOSTIC_REPORT_PATH');
const expectedSampleSha256 = requiredSha('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');
const expectedChoiceSetDefinition = 'MERGED_TOP_96';
const choiceSetLimit = 96;
const supportProbability = 0.01;
const calibrationBinCount = 10;

const sampleSha256 = await hashFile(samplePath);
assertEqual(sampleSha256, expectedSampleSha256, 'Pinned MATCH sample SHA-256');
const summary = JSON.parse(
  await readFile(`${ablationDirectory}/ablation-summary.json`, 'utf8'),
);
validateAblationSummary(summary);

const variants = [];
for (const id of ['L', 'LT']) {
  const artifact = JSON.parse(
    await readFile(`${ablationDirectory}/${id.toLowerCase()}/model.json`, 'utf8'),
  );
  validateModelArtifact(artifact, id);
  validateRecommendationBehavioralV6Model(artifact.finalModel);
  variants.push({ id, model: artifact.finalModel, accumulator: createAccumulator() });
}

const source = {
  pinnedSampleRowCount: 0,
  tuningSelectionRowCount: 0,
  tuningEvaluationRowCount: 0,
  futureTestRowCount: 0,
};
const input = createInterface({
  input: createReadStream(samplePath).pipe(createGunzip()),
  crlfDelay: Infinity,
});
for await (const line of input) {
  if (!line.trim()) continue;
  source.pinnedSampleRowCount += 1;
  const row = JSON.parse(line);
  if (row.split === 'FUTURE_TEST') {
    source.futureTestRowCount += 1;
    continue;
  }
  if (row.split !== 'TUNING') continue;
  source.tuningSelectionRowCount += 1;
  if (
    row.eligibility?.behavioralModel !== true ||
    !observedInsideTop96(row)
  ) {
    continue;
  }
  const filtered = applyTop96ChoiceSet(row);
  if (filtered.candidates.length < 2) continue;
  source.tuningEvaluationRowCount += 1;
  for (const variant of variants) {
    const prediction = predictRecommendationBehavioralV6(
      variant.model,
      filtered,
    );
    observe(variant.accumulator, filtered, prediction);
  }
  if (source.tuningEvaluationRowCount % 2_500 === 0) {
    console.log(
      JSON.stringify({
        progress: 'TUNING_DIAGNOSTIC_ROWS',
        tuningEvaluationRowCount: source.tuningEvaluationRowCount,
      }),
    );
  }
}

if (source.futureTestRowCount !== 0) {
  throw new Error(
    `Pinned Behavioral V6 sample unexpectedly contains ${source.futureTestRowCount} FUTURE_TEST rows.`,
  );
}
if (source.tuningEvaluationRowCount === 0) {
  throw new Error('Behavioral V6 tuning diagnostic has no eligible rows.');
}

const results = variants.map((variant) => ({
  id: variant.id,
  ...finalize(variant.accumulator),
}));
const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_TUNING_PROBABILITY_DIAGNOSTICS',
  executorVersion: 'TUNING_INFERENCE_STREAMING_1',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  source: {
    sampleSha256,
    ablationExecutorVersion: summary.executorVersion,
    choiceSetDefinition: summary.choiceSet.definition,
    ...source,
  },
  contracts: {
    modelVersion: RECOMMENDATION_BEHAVIORAL_V6_MODEL_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V6_PROBABILITY_CONTRACT,
    optimizerContract: RECOMMENDATION_BEHAVIORAL_V6_OPTIMIZER_CONTRACT,
  },
  diagnostics: {
    supportProbability,
    calibrationBinCount,
    brierDefinition:
      'MULTICLASS_SUM_SQUARED_ERROR_PER_DECISION_AND_PER_CANDIDATE',
    calibrationDefinition:
      'CANDIDATE_LEVEL_RELIABILITY_Y_EQUALS_OBSERVED_ACTION_INDICATOR',
    separationDefinition:
      'WITHIN_DECISION_RAW_SOFTMAX_TOP1_TOP2_MARGIN_AND_PROBABILITY_STDDEV',
  },
  results,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

function createAccumulator() {
  return {
    decisions: 0,
    candidates: 0,
    supported: 0,
    top1: 0,
    logLoss: 0,
    decisionBrier: 0,
    candidateBrier: 0,
    entropy: 0,
    margins: [],
    probabilityStddevs: [],
    scoreRanges: [],
    zeroSeparation: 0,
    candidateCalibration: Array.from({ length: calibrationBinCount }, (_, index) => ({
      index,
      lower: index / calibrationBinCount,
      upper: (index + 1) / calibrationBinCount,
      count: 0,
      predictedProbabilitySum: 0,
      observedCount: 0,
    })),
    topLabelCalibration: Array.from({ length: calibrationBinCount }, (_, index) => ({
      index,
      lower: index / calibrationBinCount,
      upper: (index + 1) / calibrationBinCount,
      count: 0,
      predictedProbabilitySum: 0,
      correctCount: 0,
    })),
  };
}

function observe(acc, row, prediction) {
  const observed = prediction.candidates.find(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  if (!observed) {
    throw new Error('Observed action is missing from a TUNING prediction.');
  }
  acc.decisions += 1;
  acc.supported +=
    observed.probability >= supportProbability ? 1 : 0;
  const topCorrect = prediction.topActionKey === row.observedActionKey;
  acc.top1 += topCorrect ? 1 : 0;
  acc.logLoss += -Math.log(Math.max(observed.probability, 1e-15));
  acc.entropy += prediction.entropy;

  let decisionBrier = 0;
  const probabilities = [];
  const scores = [];
  for (const candidate of prediction.candidates) {
    const target = candidate.actionKey === row.observedActionKey ? 1 : 0;
    const squared = (candidate.probability - target) ** 2;
    decisionBrier += squared;
    acc.candidateBrier += squared;
    acc.candidates += 1;
    probabilities.push(candidate.probability);
    scores.push(candidate.score);
    observeCandidateCalibration(
      acc.candidateCalibration,
      candidate.probability,
      target,
    );
  }
  acc.decisionBrier += decisionBrier;

  const sortedProbabilities = [...probabilities].sort((left, right) => right - left);
  const margin = sortedProbabilities[0] - (sortedProbabilities[1] ?? 0);
  acc.margins.push(margin);
  const meanProbability =
    probabilities.reduce((sum, value) => sum + value, 0) /
    probabilities.length;
  const variance =
    probabilities.reduce(
      (sum, value) => sum + (value - meanProbability) ** 2,
      0,
    ) / probabilities.length;
  acc.probabilityStddevs.push(Math.sqrt(variance));
  const scoreRange = Math.max(...scores) - Math.min(...scores);
  acc.scoreRanges.push(scoreRange);
  if (margin <= 1e-12 || scoreRange <= 1e-12) {
    acc.zeroSeparation += 1;
  }
  observeTopLabelCalibration(
    acc.topLabelCalibration,
    prediction.maximumProbability,
    topCorrect,
  );
}

function observeCandidateCalibration(bins, probability, target) {
  const bin = bins[binIndex(probability)];
  bin.count += 1;
  bin.predictedProbabilitySum += probability;
  bin.observedCount += target;
}

function observeTopLabelCalibration(bins, probability, correct) {
  const bin = bins[binIndex(probability)];
  bin.count += 1;
  bin.predictedProbabilitySum += probability;
  bin.correctCount += correct ? 1 : 0;
}

function finalize(acc) {
  const candidateReliability = finalizeCandidateCalibration(
    acc.candidateCalibration,
    acc.candidates,
  );
  const topLabelReliability = finalizeTopLabelCalibration(
    acc.topLabelCalibration,
    acc.decisions,
  );
  return {
    decisionCount: acc.decisions,
    candidateCount: acc.candidates,
    supportCoverage: divide(acc.supported, acc.decisions),
    rawLogLoss: divide(acc.logLoss, acc.decisions),
    top1Rate: divide(acc.top1, acc.decisions),
    meanMulticlassBrier: divide(acc.decisionBrier, acc.decisions),
    meanCandidateBrier: divide(acc.candidateBrier, acc.candidates),
    meanEntropy: divide(acc.entropy, acc.decisions),
    separation: {
      zeroSeparationRate: divide(acc.zeroSeparation, acc.decisions),
      top1Top2ProbabilityMargin: distribution(acc.margins),
      probabilityStddev: distribution(acc.probabilityStddevs),
      scoreRange: distribution(acc.scoreRanges),
    },
    calibration: {
      candidateLevel: candidateReliability,
      topLabel: topLabelReliability,
    },
  };
}

function finalizeCandidateCalibration(bins, totalCandidates) {
  let ece = 0;
  const values = bins.map((bin) => {
    const meanPredicted = divide(bin.predictedProbabilitySum, bin.count);
    const empiricalSelectedRate = divide(bin.observedCount, bin.count);
    const absoluteGap = Math.abs(meanPredicted - empiricalSelectedRate);
    ece += divide(bin.count, totalCandidates) * absoluteGap;
    return {
      ...bin,
      meanPredicted,
      empiricalSelectedRate,
      absoluteGap,
    };
  });
  return { expectedCalibrationError: ece, bins: values };
}

function finalizeTopLabelCalibration(bins, totalDecisions) {
  let ece = 0;
  const values = bins.map((bin) => {
    const meanPredicted = divide(bin.predictedProbabilitySum, bin.count);
    const empiricalAccuracy = divide(bin.correctCount, bin.count);
    const absoluteGap = Math.abs(meanPredicted - empiricalAccuracy);
    ece += divide(bin.count, totalDecisions) * absoluteGap;
    return {
      ...bin,
      meanPredicted,
      empiricalAccuracy,
      absoluteGap,
    };
  });
  return { expectedCalibrationError: ece, bins: values };
}

function binIndex(probability) {
  const value = Math.min(1, Math.max(0, Number(probability) || 0));
  return Math.min(
    calibrationBinCount - 1,
    Math.floor(value * calibrationBinCount),
  );
}

function distribution(values) {
  const sorted = [...values]
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return { count: 0 };
  return {
    count: sorted.length,
    min: sorted[0],
    p10: quantile(sorted, 0.1),
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function quantile(sorted, value) {
  const index = (sorted.length - 1) * value;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

function observedInsideTop96(row) {
  const index = row.candidates.findIndex(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  return index >= 0 && index < choiceSetLimit;
}

function applyTop96ChoiceSet(row) {
  const candidates = row.candidates
    .slice(0, choiceSetLimit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  return {
    ...row,
    candidates,
    observedActionInCandidateSet: true,
    eligibility: { ...row.eligibility, behavioralModel: true },
  };
}

function validateAblationSummary(value) {
  if (
    value.schemaVersion !== 2 ||
    value.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_EQUAL_CAPACITY_ABLATION' ||
    value.executorVersion !==
      'MERGED_TOP_96_AGGREGATED_OPTIMIZER_STREAMING_2' ||
    value.source?.futureTestRowCount !== 0 ||
    value.choiceSet?.definition !== expectedChoiceSetDefinition ||
    value.fullTrainingAuthorized !== false ||
    value.valueV8TrainingAuthorized !== false
  ) {
    throw new Error('Behavioral V6 ablation summary is not eligible for TUNING diagnostics.');
  }
}

function validateModelArtifact(value, id) {
  if (
    value.modelVersion !== RECOMMENDATION_BEHAVIORAL_V6_MODEL_VERSION ||
    value.probabilityContract !==
      RECOMMENDATION_BEHAVIORAL_V6_PROBABILITY_CONTRACT ||
    value.optimizerContract !== RECOMMENDATION_BEHAVIORAL_V6_OPTIMIZER_CONTRACT ||
    value.diagnosticOnly !== true ||
    value.pinnedSampleSha256 !== expectedSampleSha256 ||
    value.choiceSetDefinition !== expectedChoiceSetDefinition ||
    !value.finalModel ||
    (id === 'L' && value.finalModel.architecture !== 'LINEAR_ONLY') ||
    (id === 'LT' && value.finalModel.architecture !== 'LINEAR_PLUS_TOWER')
  ) {
    throw new Error(`Behavioral V6 ${id} model artifact is not eligible for TUNING diagnostics.`);
  }
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredSha(name) {
  const value = required(name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a SHA-256 value.`);
  }
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}.`);
  }
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}
