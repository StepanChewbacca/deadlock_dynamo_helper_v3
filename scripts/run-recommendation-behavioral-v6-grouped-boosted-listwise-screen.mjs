import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const require = createRequire(import.meta.url);
const {
  createRecommendationBehavioralV6BoostedModel,
  predictRecommendationBehavioralV6Boosted,
  recommendationBehavioralV6BoostedFeatureVector,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_BASE_SCORE,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_CATEGORICAL_FEATURES,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_FEATURE_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_NUMERIC_FEATURES,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_NUMERIC_THRESHOLDS,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_OBJECTIVE,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_PROBABILITY_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_TREE_CONTRACT,
  validateRecommendationBehavioralV6BoostedModel,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v6-boosted-listwise.js');

const samplePath = required('BEHAVIORAL_V6_SAMPLE_PATH');
const choiceSetReportPath = required('BEHAVIORAL_V6_CHOICE_SET_REPORT_PATH');
const baselineGatePath = required('BEHAVIORAL_V6_BASELINE_GATE_PATH');
const v3SummaryPath = required('BEHAVIORAL_V6_V3_SUMMARY_PATH');
const outputDirectory = required('BEHAVIORAL_V6_BOOSTED_SCREEN_OUTPUT_DIR');
const expectedSampleSha256 = requiredSha('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');
const expectedChoiceSetSha256 = requiredSha('EXPECTED_CHOICE_SET_REPORT_SHA256');

const executorVersion = 'MERGED_TOP_96_GROUPED_BOOSTED_LISTWISE_SCREEN_1';
const runtimeExecution = 'COMPACT_BINARY_TRAIN_FEATURE_SPOOL_1';
const choiceSetDefinition = 'MERGED_TOP_96';
const maximumCandidates = 96;
const config = {
  treeCount: 8,
  learningRate: 0.1,
  leafL2: 10,
  maximumLeafValue: 1.5,
  minimumLeafCandidateCount: 500,
  supportProbability: 0.01,
  propensityFloors: [0.005, 0.01, 0.02],
  majorGroupMinDecisions: 100,
};
const activeCategoricalFeatureIndices = [0, 2, 3, 5, 6, 7, 8];
const numericFeatureCount = RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_NUMERIC_FEATURES.length;
const categoricalFeatureCount = RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_CATEGORICAL_FEATURES.length;
const bytesPerCandidate = 4 * (numericFeatureCount + categoricalFeatureCount);

await validateInputs();
await mkdir(outputDirectory, { recursive: true });
const spoolPath = `${outputDirectory}/train-feature-spool.bin`;
const spoolManifestPath = `${outputDirectory}/train-feature-spool-manifest.json`;
const spool = await createCompactTrainSpool(spoolPath);
await writeJson(spoolManifestPath, spool.manifest);
console.log(JSON.stringify({ progress: 'SPOOL_COMPLETE', ...spool.manifest.counts }));

const trainingBuffer = await readFile(spoolPath);
const model = createRecommendationBehavioralV6BoostedModel(config);
const trainingRounds = [];
for (let round = 1; round <= config.treeCount; round += 1) {
  const stats = collectRoundStats(trainingBuffer, model);
  const stump = selectBestStump(stats, round);
  model.trees.push(stump);
  model.trainedDecisionCount += spool.manifest.counts.trainRowCount;
  validateRecommendationBehavioralV6BoostedModel(model);
  trainingRounds.push({
    round,
    split: stump.split,
    gain: stump.gain,
    leftValue: stump.leftValue,
    rightValue: stump.rightValue,
    leftCandidateCount: stump.leftCandidateCount,
    rightCandidateCount: stump.rightCandidateCount,
  });
  console.log(JSON.stringify({ progress: 'BOOSTING_ROUND_COMPLETE', ...trainingRounds.at(-1) }));
  await tick();
}

const tuning = await evaluateTuning(model);
const v3Summary = JSON.parse(await readFile(v3SummaryPath, 'utf8'));
const lt = v3Summary.results.find((value) => value.variant === 'LT');
if (!lt) throw new Error('V3 LT summary is missing.');
const continuationChecks = {
  candidateCoverageAtLeast099: spool.manifest.counts.candidateCoverage >= 0.99,
  supportAtLeast090: tuning.model.supportCoverage >= 0.9,
  noMajorLowSupportGroups: tuning.model.majorLowSupportGroupCount === 0,
  floorSensitivityAtMost002: tuning.model.floorSensitivityDelta <= 0.02,
  modelSupportBeatsInverseRank: tuning.model.supportCoverage > tuning.inverseRank.supportCoverage,
  modelRawLogLossBeatsInverseRank: tuning.model.rawLogLoss < tuning.inverseRank.rawLogLoss,
  modelSupportBeatsV3LT: tuning.model.supportCoverage > lt.tuningMetrics.supportCoverage,
  modelRawLogLossBeatsV3LT: tuning.model.rawLogLoss < lt.tuningMetrics.rawLogLoss,
};
const screenPassed = Object.values(continuationChecks).every(Boolean);
const modelArtifact = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_GROUPED_BOOSTED_LISTWISE_SCREEN_MODEL',
  diagnosticOnly: true,
  trainingArtifactEligible: false,
  choiceSetDefinition,
  executorVersion,
  runtimeExecution,
  config,
  model,
};
await writeJson(`${outputDirectory}/model.json`, modelArtifact);
const summary = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_GROUPED_BOOSTED_LISTWISE_SCREEN',
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
    candidateCoverage: spool.manifest.counts.candidateCoverage,
    observedActionInjected: false,
    selectedAfterObservedAction: false,
  },
  contracts: {
    modelVersion: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_PROBABILITY_CONTRACT,
    objective: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_OBJECTIVE,
    baseScoreContract: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_BASE_SCORE,
    treeContract: RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_TREE_CONTRACT,
  },
  config,
  activeCategoricalFeatureIndices,
  training: {
    trainRowCount: spool.manifest.counts.trainRowCount,
    compactSpoolByteLength: trainingBuffer.length,
    rounds: trainingRounds,
    tuningUsedForTraining: false,
    crossFittingPerformed: false,
  },
  tuning,
  v3LTReference: {
    supportCoverage: lt.tuningMetrics.supportCoverage,
    rawLogLoss: lt.tuningMetrics.rawLogLoss,
    top1Rate: lt.tuningMetrics.top1Rate,
  },
  continuationChecks,
  screenPassed,
  strictCrossFitRecommended: screenPassed,
  currentFamily: 'GROUPED_BOOSTED_LISTWISE',
  nextFamilyRecommended: screenPassed ? null : 'SEQUENCE_NEURAL',
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
await rm(spoolPath, { force: true });
await writeJson(`${outputDirectory}/screen-runtime.json`, {
  schemaVersion: 1,
  compactSpoolRemovedAfterSuccess: true,
  rowsMaterializedAsDatasetObjectsInHeap: false,
  tuningUsedForTraining: false,
});
console.log(JSON.stringify(summary, null, 2));

async function validateInputs() {
  if ((await hashFile(samplePath)) !== expectedSampleSha256) {
    throw new Error('Pinned sample SHA-256 mismatch.');
  }
  if ((await hashFile(choiceSetReportPath)) !== expectedChoiceSetSha256) {
    throw new Error('Frozen choice-set report SHA-256 mismatch.');
  }
  const choiceSet = JSON.parse(await readFile(choiceSetReportPath, 'utf8'));
  const selected = choiceSet.variants.find((value) => value.id === choiceSetDefinition);
  if (!selected?.gate?.passed || selected.overall.observedCoverage < 0.99) {
    throw new Error('MERGED_TOP_96 frozen choice-set gate is not eligible.');
  }
  const gate = JSON.parse(await readFile(baselineGatePath, 'utf8'));
  if (
    gate.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_ABLATION_BASELINE_GATE' ||
    gate.currentFamilyContinuationRecommended !== false ||
    gate.nextFamilyRecommended !== 'GROUPED_BOOSTED_LISTWISE' ||
    gate.futureTestEvaluated !== false ||
    gate.fullTrainingAuthorized !== false ||
    gate.valueV8TrainingAuthorized !== false
  ) {
    throw new Error('Current-family baseline gate does not authorize boosted-listwise screening.');
  }
}

async function createCompactTrainSpool(path) {
  const output = createWriteStream(path, { flags: 'wx' });
  let pinnedSampleRowCount = 0;
  let selectionRowCount = 0;
  let candidateCoveredSelectionRowCount = 0;
  let filteredSelectionRowCount = 0;
  let trainRowCount = 0;
  let tuningRowCount = 0;
  let futureTestRowCount = 0;
  const input = createInterface({
    input: createReadStream(samplePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    pinnedSampleRowCount += 1;
    if (row.split === 'FUTURE_TEST') {
      futureTestRowCount += 1;
      continue;
    }
    if (row.split !== 'TRAIN' && row.split !== 'TUNING') continue;
    selectionRowCount += 1;
    const observedIndex = row.candidates.findIndex(
      (candidate) => candidate.actionKey === row.observedActionKey,
    );
    if (observedIndex < 0 || observedIndex >= maximumCandidates) continue;
    candidateCoveredSelectionRowCount += 1;
    if (row.eligibility?.behavioralModel !== true) continue;
    const top = row.candidates.slice(0, maximumCandidates).map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
    if (top.length < 2) continue;
    filteredSelectionRowCount += 1;
    if (row.split === 'TUNING') {
      tuningRowCount += 1;
      continue;
    }
    trainRowCount += 1;
    const header = Buffer.allocUnsafe(4);
    header.writeUInt16LE(top.length, 0);
    header.writeUInt16LE(observedIndex, 2);
    if (!output.write(header)) await onceDrain(output);
    for (const candidate of top) {
      const features = recommendationBehavioralV6BoostedFeatureVector(row, candidate);
      const buffer = Buffer.allocUnsafe(bytesPerCandidate);
      let offset = 0;
      for (const value of features.numeric) {
        buffer.writeFloatLE(value, offset);
        offset += 4;
      }
      for (const value of features.categorical) {
        buffer.writeUInt32LE(value >>> 0, offset);
        offset += 4;
      }
      if (!output.write(buffer)) await onceDrain(output);
    }
    if (trainRowCount % 5000 === 0) {
      console.log(JSON.stringify({ progress: 'SPOOL_TRAIN_ROWS', trainRowCount }));
    }
  }
  await endStream(output);
  if (futureTestRowCount !== 0) throw new Error(`FUTURE_TEST row count must be zero, got ${futureTestRowCount}.`);
  const candidateCoverage = divide(candidateCoveredSelectionRowCount, selectionRowCount);
  if (candidateCoverage < 0.99) throw new Error(`Candidate coverage ${candidateCoverage} is below 0.99.`);
  return {
    manifest: {
      schemaVersion: 1,
      runtimeExecution,
      sourceSampleSha256: expectedSampleSha256,
      choiceSetDefinition,
      numericFeatureCount,
      categoricalFeatureCount,
      bytesPerCandidate,
      counts: {
        pinnedSampleRowCount,
        selectionRowCount,
        candidateCoveredSelectionRowCount,
        filteredSelectionRowCount,
        trainRowCount,
        tuningRowCount,
        futureTestRowCount,
        candidateCoverage,
      },
    },
  };
}

function collectRoundStats(buffer, model) {
  const numeric = RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_NUMERIC_THRESHOLDS.map(
    (thresholds) => Array.from({ length: thresholds.length + 1 }, emptyStats),
  );
  const categorical = new Map(activeCategoricalFeatureIndices.map((index) => [index, new Map()]));
  const total = emptyStats();
  let offset = 0;
  let decisionCount = 0;
  while (offset < buffer.length) {
    const candidateCount = buffer.readUInt16LE(offset);
    const observedIndex = buffer.readUInt16LE(offset + 2);
    offset += 4;
    const candidates = [];
    for (let index = 0; index < candidateCount; index += 1) {
      const numericValues = new Array(numericFeatureCount);
      const categoricalValues = new Array(categoricalFeatureCount);
      for (let feature = 0; feature < numericFeatureCount; feature += 1) {
        numericValues[feature] = buffer.readFloatLE(offset);
        offset += 4;
      }
      for (let feature = 0; feature < categoricalFeatureCount; feature += 1) {
        categoricalValues[feature] = buffer.readUInt32LE(offset);
        offset += 4;
      }
      candidates.push({ numeric: numericValues, categorical: categoricalValues });
    }
    const scores = candidates.map((features) => compactScore(model, features));
    const probabilities = softmax(scores);
    for (let index = 0; index < candidates.length; index += 1) {
      const probability = probabilities[index];
      const gradient = (index === observedIndex ? 1 : 0) - probability;
      const hessian = Math.max(1e-6, probability * (1 - probability));
      addStats(total, gradient, hessian);
      const features = candidates[index];
      for (let feature = 0; feature < numeric.length; feature += 1) {
        const thresholds = RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_NUMERIC_THRESHOLDS[feature];
        const bin = upperBound(thresholds, features.numeric[feature]);
        addStats(numeric[feature][bin], gradient, hessian);
      }
      for (const feature of activeCategoricalFeatureIndices) {
        const map = categorical.get(feature);
        const category = features.categorical[feature];
        let stats = map.get(category);
        if (!stats) {
          stats = emptyStats();
          map.set(category, stats);
        }
        addStats(stats, gradient, hessian);
      }
    }
    decisionCount += 1;
  }
  return { total, numeric, categorical, decisionCount };
}

function selectBestStump(stats, round) {
  let best;
  for (let feature = 0; feature < stats.numeric.length; feature += 1) {
    const bins = stats.numeric[feature];
    const thresholds = RECOMMENDATION_BEHAVIORAL_V6_BOOSTED_NUMERIC_THRESHOLDS[feature];
    const left = emptyStats();
    for (let index = 0; index < thresholds.length; index += 1) {
      mergeStats(left, bins[index]);
      const candidate = splitCandidate(
        { kind: 'NUMERIC_LE', featureIndex: feature, threshold: thresholds[index] },
        left,
        subtractStats(stats.total, left),
      );
      best = betterSplit(best, candidate);
    }
  }
  for (const [featureIndex, categories] of stats.categorical.entries()) {
    for (const [categoryHash, left] of categories.entries()) {
      const candidate = splitCandidate(
        { kind: 'CATEGORICAL_EQ', featureIndex, categoryHash },
        left,
        subtractStats(stats.total, left),
      );
      best = betterSplit(best, candidate);
    }
  }
  if (!best || !(best.gain > 0)) throw new Error(`No positive boosted split found at round ${round}.`);
  return {
    split: best.split,
    leftValue: clamp(best.left.g / (best.left.h + config.leafL2), -config.maximumLeafValue, config.maximumLeafValue),
    rightValue: clamp(best.right.g / (best.right.h + config.leafL2), -config.maximumLeafValue, config.maximumLeafValue),
    gain: best.gain,
    leftCandidateCount: best.left.count,
    rightCandidateCount: best.right.count,
    round,
  };
}

function splitCandidate(split, left, right) {
  if (
    left.count < config.minimumLeafCandidateCount ||
    right.count < config.minimumLeafCandidateCount
  ) return undefined;
  const parentG = left.g + right.g;
  const parentH = left.h + right.h;
  const gain = 0.5 * (
    left.g ** 2 / (left.h + config.leafL2) +
    right.g ** 2 / (right.h + config.leafL2) -
    parentG ** 2 / (parentH + config.leafL2)
  );
  if (!Number.isFinite(gain) || gain <= 0) return undefined;
  return { split, left: { ...left }, right: { ...right }, gain };
}

function betterSplit(current, candidate) {
  if (!candidate) return current;
  if (!current || candidate.gain > current.gain + 1e-12) return candidate;
  if (Math.abs(candidate.gain - current.gain) > 1e-12) return current;
  return splitKey(candidate.split).localeCompare(splitKey(current.split)) < 0 ? candidate : current;
}

function compactScore(model, features) {
  const rank = Math.max(1, features.numeric[0]);
  let score = -Math.log(rank);
  for (const stump of model.trees) {
    const left = stump.split.kind === 'NUMERIC_LE'
      ? features.numeric[stump.split.featureIndex] <= stump.split.threshold
      : features.categorical[stump.split.featureIndex] === stump.split.categoryHash;
    score += model.learningRate * (left ? stump.leftValue : stump.rightValue);
  }
  return score;
}

async function evaluateTuning(model) {
  const modelAccumulator = createAccumulator();
  const inverseAccumulator = createAccumulator();
  let decisionCount = 0;
  const input = createInterface({ input: createReadStream(samplePath).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.split !== 'TUNING' || row.eligibility?.behavioralModel !== true) continue;
    const observedIndex = row.candidates.findIndex((candidate) => candidate.actionKey === row.observedActionKey);
    if (observedIndex < 0 || observedIndex >= maximumCandidates) continue;
    const top = row.candidates.slice(0, maximumCandidates).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
    if (top.length < 2) continue;
    const selectedRow = { ...row, candidates: top, observedActionInCandidateSet: true };
    observe(modelAccumulator, selectedRow, predictRecommendationBehavioralV6Boosted(model, selectedRow));
    observe(inverseAccumulator, selectedRow, inverseRankPrediction(selectedRow));
    decisionCount += 1;
  }
  if (decisionCount === 0) throw new Error('No TUNING decisions were evaluated.');
  return {
    decisionCount,
    model: finalizeAccumulator(modelAccumulator),
    inverseRank: finalizeAccumulator(inverseAccumulator),
  };
}

function inverseRankPrediction(row) {
  const weights = row.candidates.map((candidate) => 1 / Math.max(1, candidate.rank));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const candidates = row.candidates.map((candidate, index) => ({
    actionKey: candidate.actionKey,
    probability: weights[index] / total,
  }));
  let top = candidates[0];
  for (const candidate of candidates.slice(1)) if (candidate.probability > top.probability) top = candidate;
  return {
    candidates,
    observedActionProbability: candidates.find((candidate) => candidate.actionKey === row.observedActionKey)?.probability ?? 0,
    topActionKey: top.actionKey,
  };
}

function createAccumulator() {
  return {
    selection: emptyMetric(),
    groups: new Map(),
    floorLossSums: new Map(config.propensityFloors.map((floor) => [floor, 0])),
  };
}

function observe(acc, row, prediction) {
  const p = prediction.observedActionProbability;
  observeMetric(acc.selection, prediction, p, p >= config.supportProbability, prediction.topActionKey === row.observedActionKey);
  const observed = row.candidates.find((candidate) => candidate.actionKey === row.observedActionKey);
  const keys = [
    `HERO:${row.state.heroId}`,
    `PHASE:${row.state.phase}`,
    `TIME:${timeBucket(row.state.gameTimeS)}`,
    `ECONOMY:${economyBand(row.state.netWorth)}`,
    `ACTION:${String(row.observedActionKey).split(':')[0]}`,
    `TIER:${observed?.tier ?? 'UNKNOWN'}`,
  ];
  for (const key of keys) {
    let metric = acc.groups.get(key);
    if (!metric) { metric = emptyMetric(); acc.groups.set(key, metric); }
    observeMetric(metric, prediction, p, p >= config.supportProbability, prediction.topActionKey === row.observedActionKey);
  }
  for (const floor of config.propensityFloors) {
    acc.floorLossSums.set(floor, acc.floorLossSums.get(floor) - Math.log(Math.max(p, floor)));
  }
}

function observeMetric(metric, prediction, p, supported, top1) {
  metric.decisions += 1;
  metric.supported += supported ? 1 : 0;
  metric.top1 += top1 ? 1 : 0;
  metric.loss += -Math.log(Math.max(p, 1e-15));
  metric.observedProbability += p;
  metric.minimumObservedProbability = Math.min(metric.minimumObservedProbability, p);
  for (const candidate of prediction.candidates) {
    metric.candidateCount += 1;
    if (candidate.probability <= 1e-8 || candidate.probability >= 1 - 1e-8) metric.extremeCandidates += 1;
  }
}

function finalizeAccumulator(acc) {
  const selection = finalizeMetric(acc.selection);
  const groups = [...acc.groups.entries()].map(([key, metric]) => ({
    key,
    major: metric.decisions >= config.majorGroupMinDecisions,
    ...finalizeMetric(metric),
  }));
  const majorLowSupportGroups = groups.filter((group) => group.major && group.supportCoverage < 0.75);
  const floors = config.propensityFloors.map((floor) => {
    const logLoss = acc.floorLossSums.get(floor) / acc.selection.decisions;
    return { floor, logLoss, delta: Math.abs(selection.rawLogLoss - logLoss) };
  });
  return {
    ...selection,
    majorLowSupportGroupCount: majorLowSupportGroups.length,
    majorLowSupportGroups,
    floorSensitivityDelta: Math.max(...floors.map((value) => value.delta)),
    floorSensitivity: floors,
    groups,
  };
}

function emptyMetric() {
  return { decisions: 0, supported: 0, top1: 0, loss: 0, observedProbability: 0, minimumObservedProbability: 1, extremeCandidates: 0, candidateCount: 0 };
}

function finalizeMetric(metric) {
  return {
    decisionCount: metric.decisions,
    supportCoverage: divide(metric.supported, metric.decisions),
    rawLogLoss: divide(metric.loss, metric.decisions),
    top1Rate: divide(metric.top1, metric.decisions),
    meanObservedRawProbability: divide(metric.observedProbability, metric.decisions),
    minimumObservedRawProbability: metric.decisions > 0 ? metric.minimumObservedProbability : 0,
    extremeCandidateProbabilityRate: divide(metric.extremeCandidates, metric.candidateCount),
  };
}

function emptyStats() { return { g: 0, h: 0, count: 0 }; }
function addStats(stats, g, h) { stats.g += g; stats.h += h; stats.count += 1; }
function mergeStats(target, source) { target.g += source.g; target.h += source.h; target.count += source.count; }
function subtractStats(total, left) { return { g: total.g - left.g, h: total.h - left.h, count: total.count - left.count }; }

function upperBound(thresholds, value) {
  let index = 0;
  while (index < thresholds.length && value > thresholds[index]) index += 1;
  return index;
}

function softmax(scores) {
  const max = Math.max(...scores);
  const weights = scores.map((score) => Math.exp(score - max));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

function splitKey(split) {
  return split.kind === 'NUMERIC_LE'
    ? `N:${String(split.featureIndex).padStart(2, '0')}:${split.threshold}`
    : `C:${String(split.featureIndex).padStart(2, '0')}:${String(split.categoryHash).padStart(10, '0')}`;
}

function timeBucket(seconds) { const start = Math.floor(Number(seconds || 0) / 300) * 5; return `${start}-${start + 5}m`; }
function economyBand(netWorth) { const value = Number(netWorth || 0); if (value < 5000) return 'LT_5000'; if (value < 10000) return '5000_9999'; if (value < 15000) return '10000_14999'; if (value < 20000) return '15000_19999'; return 'GE_20000'; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function divide(n, d) { return d > 0 ? n / d : 0; }
function tick() { return new Promise((resolve) => setImmediate(resolve)); }
function onceDrain(stream) { return new Promise((resolve) => stream.once('drain', resolve)); }
function endStream(stream) { return new Promise((resolve, reject) => { stream.once('error', reject); stream.end(resolve); }); }
function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name}.`); return value; }
function requiredSha(name) { const value = required(name); if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be SHA-256.`); return value; }
async function hashFile(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
async function writeJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function renderReport(summary) {
  return [
    'Recommendation Behavioral V6 Grouped Boosted Listwise Screen',
    `screenPassed=${summary.screenPassed}`,
    `support=${summary.tuning.model.supportCoverage}`,
    `rawLogLoss=${summary.tuning.model.rawLogLoss}`,
    `top1=${summary.tuning.model.top1Rate}`,
    `inverseRankSupport=${summary.tuning.inverseRank.supportCoverage}`,
    `inverseRankRawLogLoss=${summary.tuning.inverseRank.rawLogLoss}`,
    `nextFamilyRecommended=${summary.nextFamilyRecommended ?? 'NONE'}`,
    '',
  ].join('\n');
}
