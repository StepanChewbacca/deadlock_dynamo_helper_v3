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
const reportPath = required('BEHAVIORAL_V6_LATENT_STATE_DIAGNOSTIC_REPORT_PATH');
const expectedSampleSha256 = requiredSha('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');

const executorVersion = 'PREDECISION_REGIME_ENTROPY_DIAGNOSTIC_1';
const maximumCandidates = 96;
const hardProbability = 0.01;
const minimumRegimeDecisionCount = 20;
const regimeDefinitions = [
  { id: 'COARSE_STATE', level: 0, key: coarseStateKey },
  { id: 'STATE_HISTORY_STAGE_LAST1', level: 1, key: stateHistoryStageLast1Key },
  { id: 'STATE_HISTORY_SUFFIX2', level: 2, key: stateHistorySuffix2Key },
  { id: 'STATE_BUILD_SIGNATURE', level: 3, key: stateBuildSignatureKey },
];

if ((await hashFile(samplePath)) !== expectedSampleSha256) {
  throw new Error('Pinned sample SHA-256 mismatch.');
}
const modelArtifact = JSON.parse(await readFile(sequenceModelPath, 'utf8'));
const sequenceSummary = JSON.parse(await readFile(sequenceSummaryPath, 'utf8'));
validateInputs(modelArtifact, sequenceSummary);
const model = modelArtifact.model;
validateRecommendationBehavioralV6SequenceModel(model);

const matchCounts = await collectEligibleTuningMatchCounts();
const partition = createBalancedMatchPartition(matchCounts);
const compactRows = await collectCompactTuningRows(model, partition.assignment);
if (compactRows.futureTestRowCount !== 0) {
  throw new Error(`FUTURE_TEST row count must be zero, got ${compactRows.futureTestRowCount}.`);
}

const partitionResults = {};
for (const side of ['A', 'B']) {
  const rows = compactRows.rows.filter((row) => row.partition === side);
  partitionResults[side] = evaluatePartition(rows);
}
const overall = evaluatePartition(compactRows.rows);
const enrichedIds = regimeDefinitions.filter((definition) => definition.level > 0).map((definition) => definition.id);
const qualifiedInBoth = enrichedIds.filter((id) => {
  const left = partitionResults.A.regimes[id];
  const right = partitionResults.B.regimes[id];
  return (
    left.qualifiedCoverage >= 0.7 &&
    right.qualifiedCoverage >= 0.7 &&
    left.entropyReductionBitsVsCoarseSameRows >= 0.15 &&
    right.entropyReductionBitsVsCoarseSameRows >= 0.15 &&
    left.hardRateWeightedStdDev >= 0.04 &&
    right.hardRateWeightedStdDev >= 0.04
  );
});
const bestRegimeId = [...qualifiedInBoth].sort((left, right) => {
  const leftScore =
    partitionResults.A.regimes[left].entropyReductionBitsVsCoarseSameRows +
    partitionResults.B.regimes[left].entropyReductionBitsVsCoarseSameRows;
  const rightScore =
    partitionResults.A.regimes[right].entropyReductionBitsVsCoarseSameRows +
    partitionResults.B.regimes[right].entropyReductionBitsVsCoarseSameRows;
  return rightScore - leftScore || left.localeCompare(right);
})[0];

const latentStateSignalSupported = Boolean(bestRegimeId);
const selected = bestRegimeId ? overall.regimes[bestRegimeId] : undefined;
const diagnosticChecks = {
  bothMatchPartitionsLarge: partition.countA >= 2_000 && partition.countB >= 2_000,
  sequenceOrderedHistorySignalAlreadyObserved:
    sequenceSummary.continuationChecks?.orderedHistorySignalObserved === true,
  enrichedRegimeQualifiedInBothPartitions: qualifiedInBoth.length > 0,
  selectedOverallCoverageAtLeast070: selected ? selected.qualifiedCoverage >= 0.7 : false,
  selectedOverallEntropyReductionAtLeast015: selected
    ? selected.entropyReductionBitsVsCoarseSameRows >= 0.15
    : false,
  selectedLateEntropyReductionPositive: selected
    ? selected.lateEntropyReductionBitsVsCoarseSameRows > 0
    : false,
  selectedHighEconomyEntropyReductionPositive: selected
    ? selected.highEconomyEntropyReductionBitsVsCoarseSameRows > 0
    : false,
};

const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_LATENT_STATE_REGIME_DIAGNOSTIC',
  executorVersion,
  generatedAt: new Date().toISOString(),
  source: {
    pinnedSampleSha256: expectedSampleSha256,
    sequenceModelVersion: model.modelVersion,
    probabilityContract: model.probabilityContract,
    sequenceScreenPassed: sequenceSummary.screenPassed,
    orderedHistorySignalObserved:
      sequenceSummary.continuationChecks?.orderedHistorySignalObserved === true,
    futureTestRowCount: compactRows.futureTestRowCount,
  },
  protocol: {
    assignmentInputs: [
      'heroId',
      'phase',
      'gameTimeS',
      'netWorth',
      'inventoryItemCounts',
      'inventoryTagCounts',
      'previousActionKeys',
    ],
    assignmentUsesObservedAction: false,
    assignmentUsesOutcome: false,
    assignmentUsesFutureState: false,
    observedActionUsedOnlyForDescriptiveConditionalEntropy: true,
    matchPartitionContract: 'MATCH_COUNT_DESC_FNV1A_TIE_GREEDY_2',
    minimumRegimeDecisionCount,
    hardProbability,
    regimeDefinitions: regimeDefinitions.map(({ id, level }) => ({ id, level })),
  },
  partition: {
    matchCountA: partition.matchCountA,
    matchCountB: partition.matchCountB,
    decisionCountA: partition.countA,
    decisionCountB: partition.countB,
    decisionCountImbalance: Math.abs(partition.countA - partition.countB),
  },
  sequenceDiagnostics: compactRows.sequenceDiagnostics,
  partitions: partitionResults,
  overall,
  qualifiedRegimeIdsInBothPartitions: qualifiedInBoth,
  selectedRegimeId: bestRegimeId ?? null,
  selectedRegime: selected ?? null,
  diagnosticChecks,
  latentStateSignalSupported,
  boundedLatentMixtureScreenRecommended: latentStateSignalSupported,
  nextStep: latentStateSignalSupported
    ? 'BOUNDED_LATENT_STATE_MIXTURE_SCREEN'
    : 'DOCUMENT_OBSERVABILITY_SUPPORT_CEILING',
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
console.log(JSON.stringify({
  operation: report.operation,
  partition: report.partition,
  sequenceDiagnostics: report.sequenceDiagnostics,
  qualifiedRegimeIdsInBothPartitions: report.qualifiedRegimeIdsInBothPartitions,
  selectedRegimeId: report.selectedRegimeId,
  selectedRegime: report.selectedRegime,
  diagnosticChecks: report.diagnosticChecks,
  latentStateSignalSupported: report.latentStateSignalSupported,
  boundedLatentMixtureScreenRecommended: report.boundedLatentMixtureScreenRecommended,
  nextStep: report.nextStep,
}, null, 2));

function validateInputs(modelArtifact, summary) {
  if (
    modelArtifact.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_NEURAL_SCREEN_MODEL' ||
    modelArtifact.diagnosticOnly !== true ||
    modelArtifact.trainingArtifactEligible !== false ||
    modelArtifact.choiceSetDefinition !== 'MERGED_TOP_96' ||
    modelArtifact.model?.modelVersion !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_MODEL_VERSION ||
    modelArtifact.model?.probabilityContract !== RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_PROBABILITY_CONTRACT
  ) {
    throw new Error('Sequence screen model artifact is not eligible for latent-state diagnostics.');
  }
  if (
    summary.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_SEQUENCE_NEURAL_SCREEN' ||
    summary.source?.futureTestRowCount !== 0 ||
    summary.training?.tuningUsedForTraining !== false ||
    summary.training?.tuningUsedForEarlyStopping !== false ||
    summary.screenPassed !== false ||
    summary.continuationChecks?.orderedHistorySignalObserved !== true ||
    summary.trainingArtifactEligible !== false ||
    summary.nextFamilyRecommended !== 'LATENT_STATE_MIXTURE_OR_STATE_RECONSTRUCTION'
  ) {
    throw new Error('Sequence screen summary does not authorize latent-state diagnostics.');
  }
}

async function collectEligibleTuningMatchCounts() {
  const counts = new Map();
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
    if (!selectTop96(row)) continue;
    const matchId = String(row.matchId);
    counts.set(matchId, (counts.get(matchId) ?? 0) + 1);
  }
  if (futureTestRowCount !== 0) {
    throw new Error(`FUTURE_TEST row count must be zero, got ${futureTestRowCount}.`);
  }
  return counts;
}

function createBalancedMatchPartition(matchCounts) {
  const entries = [...matchCounts.entries()].sort((left, right) =>
    right[1] - left[1] || fnv1a32(left[0]) - fnv1a32(right[0]) || left[0].localeCompare(right[0]),
  );
  const assignment = new Map();
  let countA = 0;
  let countB = 0;
  let matchCountA = 0;
  let matchCountB = 0;
  for (const [matchId, count] of entries) {
    const side =
      countA < countB
        ? 'A'
        : countB < countA
          ? 'B'
          : fnv1a32(matchId) % 2 === 0
            ? 'A'
            : 'B';
    assignment.set(matchId, side);
    if (side === 'A') {
      countA += count;
      matchCountA += 1;
    } else {
      countB += count;
      matchCountB += 1;
    }
  }
  return { assignment, countA, countB, matchCountA, matchCountB };
}

async function collectCompactTuningRows(model, assignment) {
  const rows = [];
  let futureTestRowCount = 0;
  const sequenceMetric = emptySequenceMetric();
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
    const observedProbability = prediction.observedActionProbability;
    const hard = observedProbability < hardProbability;
    observeSequenceMetric(sequenceMetric, selected, observedProbability, hard);
    const regimeKeys = Object.fromEntries(
      regimeDefinitions.map((definition) => [definition.id, definition.key(selected)]),
    );
    rows.push({
      partition: assignment.get(String(selected.matchId)),
      observedActionKey: selected.observedActionKey,
      hard,
      late: selected.state.phase === 'LATE',
      highEconomy: economyBand(selected.state.netWorth) === 'GE_20000',
      regimeKeys,
    });
  }
  return {
    rows,
    futureTestRowCount,
    sequenceDiagnostics: finalizeSequenceMetric(sequenceMetric),
  };
}

function evaluatePartition(rows) {
  const regimes = {};
  const coarseDefinition = regimeDefinitions[0];
  for (const definition of regimeDefinitions) {
    const grouped = groupRows(rows, definition.id);
    const qualifiedKeys = new Set(
      [...grouped.entries()]
        .filter(([, values]) => values.length >= minimumRegimeDecisionCount)
        .map(([key]) => key),
    );
    const qualifiedRows = rows.filter((row) => qualifiedKeys.has(row.regimeKeys[definition.id]));
    const enrichedEntropy = conditionalEntropyBits(qualifiedRows, definition.id);
    const coarseEntropySameRows = conditionalEntropyBits(qualifiedRows, coarseDefinition.id);
    const lateRows = qualifiedRows.filter((row) => row.late);
    const highEconomyRows = qualifiedRows.filter((row) => row.highEconomy);
    const lateEntropy = conditionalEntropyBits(lateRows, definition.id);
    const lateCoarseEntropy = conditionalEntropyBits(lateRows, coarseDefinition.id);
    const highEconomyEntropy = conditionalEntropyBits(highEconomyRows, definition.id);
    const highEconomyCoarseEntropy = conditionalEntropyBits(highEconomyRows, coarseDefinition.id);
    const hardRateStats = groupHardRateStats(grouped, qualifiedKeys);
    regimes[definition.id] = {
      level: definition.level,
      totalRowCount: rows.length,
      qualifiedRowCount: qualifiedRows.length,
      qualifiedCoverage: divide(qualifiedRows.length, rows.length),
      qualifiedRegimeCount: qualifiedKeys.size,
      conditionalEntropyBits: enrichedEntropy,
      coarseEntropyBitsSameRows: coarseEntropySameRows,
      entropyReductionBitsVsCoarseSameRows: coarseEntropySameRows - enrichedEntropy,
      lateRowCount: lateRows.length,
      lateEntropyBits: lateEntropy,
      lateCoarseEntropyBitsSameRows: lateCoarseEntropy,
      lateEntropyReductionBitsVsCoarseSameRows: lateCoarseEntropy - lateEntropy,
      highEconomyRowCount: highEconomyRows.length,
      highEconomyEntropyBits: highEconomyEntropy,
      highEconomyCoarseEntropyBitsSameRows: highEconomyCoarseEntropy,
      highEconomyEntropyReductionBitsVsCoarseSameRows:
        highEconomyCoarseEntropy - highEconomyEntropy,
      hardRateWeightedMean: hardRateStats.mean,
      hardRateWeightedStdDev: hardRateStats.stdDev,
      hardRateMin: hardRateStats.minimum,
      hardRateMax: hardRateStats.maximum,
      hardRateRange: hardRateStats.maximum - hardRateStats.minimum,
    };
  }
  return { rowCount: rows.length, regimes };
}

function groupRows(rows, regimeId) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.regimeKeys[regimeId];
    let values = groups.get(key);
    if (!values) {
      values = [];
      groups.set(key, values);
    }
    values.push(row);
  }
  return groups;
}

function conditionalEntropyBits(rows, regimeId) {
  if (rows.length === 0) return 0;
  const groups = groupRows(rows, regimeId);
  let weightedEntropy = 0;
  for (const values of groups.values()) {
    const actionCounts = new Map();
    for (const row of values) {
      actionCounts.set(row.observedActionKey, (actionCounts.get(row.observedActionKey) ?? 0) + 1);
    }
    let entropy = 0;
    for (const count of actionCounts.values()) {
      const probability = count / values.length;
      entropy -= probability * Math.log2(probability);
    }
    weightedEntropy += values.length * entropy;
  }
  return weightedEntropy / rows.length;
}

function groupHardRateStats(grouped, qualifiedKeys) {
  const values = [];
  let totalWeight = 0;
  let weightedSum = 0;
  for (const [key, rows] of grouped.entries()) {
    if (!qualifiedKeys.has(key)) continue;
    const hardCount = rows.reduce((sum, row) => sum + (row.hard ? 1 : 0), 0);
    const rate = hardCount / rows.length;
    values.push({ rate, weight: rows.length });
    totalWeight += rows.length;
    weightedSum += rows.length * rate;
  }
  if (values.length === 0) {
    return { mean: 0, stdDev: 0, minimum: 0, maximum: 0 };
  }
  const mean = weightedSum / totalWeight;
  const variance = values.reduce(
    (sum, value) => sum + value.weight * (value.rate - mean) ** 2,
    0,
  ) / totalWeight;
  return {
    mean,
    stdDev: Math.sqrt(variance),
    minimum: Math.min(...values.map((value) => value.rate)),
    maximum: Math.max(...values.map((value) => value.rate)),
  };
}

function coarseStateKey(row) {
  return [
    `H${row.state.heroId}`,
    `P${row.state.phase}`,
    `T${Math.floor(row.state.gameTimeS / 600)}`,
    `E${economyBand(row.state.netWorth)}`,
    `I${inventorySizeBand(row)}`,
  ].join('|');
}

function stateHistoryStageLast1Key(row) {
  const history = row.state.previousActionKeys;
  return [
    coarseStateKey(row),
    `HL${historyLengthBand(history.length)}`,
    `L1${history[history.length - 1] ?? 'NONE'}`,
  ].join('|');
}

function stateHistorySuffix2Key(row) {
  const history = row.state.previousActionKeys;
  const last1 = history[history.length - 1] ?? 'NONE';
  const last2 = history[history.length - 2] ?? 'NONE';
  return [
    coarseStateKey(row),
    `HL${historyLengthBand(history.length)}`,
    `L2${last2}>${last1}`,
  ].join('|');
}

function stateBuildSignatureKey(row) {
  const history = row.state.previousActionKeys;
  const suffix = history.slice(-3).join('>') || 'NONE';
  return [
    `H${row.state.heroId}`,
    `P${row.state.phase}`,
    `E${economyBand(row.state.netWorth)}`,
    `I${inventorySizeBand(row)}`,
    `TAGS${inventoryTagSignature(row)}`,
    `HL${historyLengthBand(history.length)}`,
    `S3${suffix}`,
  ].join('|');
}

function inventoryTagSignature(row) {
  const entries = Object.entries(row.state.inventoryTagCounts ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([tag, count]) => `${tag}:${Math.min(3, Number(count))}`);
  return entries.join(',') || 'NONE';
}

function historyLengthBand(length) {
  if (length <= 3) return 'LE3';
  if (length <= 6) return '4_6';
  if (length <= 9) return '7_9';
  if (length <= 12) return '10_12';
  return 'GE13';
}

function inventorySizeBand(row) {
  const size = row.state.inventoryItemCounts.reduce((sum, entry) => sum + entry.count, 0);
  if (size <= 3) return 'LE3';
  if (size <= 6) return '4_6';
  if (size <= 9) return '7_9';
  return 'GE10';
}

function economyBand(netWorth) {
  const value = Number(netWorth || 0);
  if (value < 5_000) return 'LT5000';
  if (value < 10_000) return '5000_9999';
  if (value < 15_000) return '10000_14999';
  if (value < 20_000) return '15000_19999';
  return 'GE_20000';
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

function emptySequenceMetric() {
  return {
    decisions: 0,
    hard: 0,
    lateDecisions: 0,
    lateHard: 0,
    highEconomyDecisions: 0,
    highEconomyHard: 0,
    probabilitySum: 0,
  };
}

function observeSequenceMetric(metric, row, probability, hard) {
  metric.decisions += 1;
  metric.hard += hard ? 1 : 0;
  metric.probabilitySum += probability;
  if (row.state.phase === 'LATE') {
    metric.lateDecisions += 1;
    metric.lateHard += hard ? 1 : 0;
  }
  if (economyBand(row.state.netWorth) === 'GE_20000') {
    metric.highEconomyDecisions += 1;
    metric.highEconomyHard += hard ? 1 : 0;
  }
}

function finalizeSequenceMetric(metric) {
  return {
    decisionCount: metric.decisions,
    supportCoverage: 1 - divide(metric.hard, metric.decisions),
    hardRate: divide(metric.hard, metric.decisions),
    meanObservedProbability: divide(metric.probabilitySum, metric.decisions),
    lateDecisionCount: metric.lateDecisions,
    lateSupportCoverage: 1 - divide(metric.lateHard, metric.lateDecisions),
    lateHardRate: divide(metric.lateHard, metric.lateDecisions),
    highEconomyDecisionCount: metric.highEconomyDecisions,
    highEconomySupportCoverage:
      1 - divide(metric.highEconomyHard, metric.highEconomyDecisions),
    highEconomyHardRate: divide(metric.highEconomyHard, metric.highEconomyDecisions),
  };
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
