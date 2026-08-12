import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const require = createRequire(import.meta.url);
const {
  prepareRecommendationSerializedHeroBuildPolicy,
  validateRecommendationCandidateGeneratorSnapshotArtifact,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-candidate-generator-snapshot.js');
const {
  generateRecommendationBehavioralV6ChoiceSetProvenance,
  RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_VERSION,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v6-choice-set.js');

const samplePath = required('BEHAVIORAL_V6_SAMPLE_PATH');
const snapshotDirectory = required('BEHAVIORAL_V6_SNAPSHOT_DIR');
const reportPath = required('BEHAVIORAL_V6_CHOICE_SET_REPORT_PATH');
const expectedSampleSha256 = required('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');

const actualSampleSha256 = await sha256File(samplePath);
if (actualSampleSha256 !== expectedSampleSha256) {
  throw new Error(
    `Pinned sample SHA mismatch: expected ${expectedSampleSha256}, received ${actualSampleSha256}.`,
  );
}

const artifacts = await loadArtifacts(snapshotDirectory);
const artifactByLineage = new Map();
const preparedPolicies = new Map();
for (const artifact of artifacts) {
  validateRecommendationCandidateGeneratorSnapshotArtifact(artifact);
  artifactByLineage.set(lineageKey(artifact.snapshot.policySha256, artifact.snapshot.catalogSha256), artifact);
}

const totals = emptyAccumulator();
const byTimeBucket = new Map();
const byEconomyBand = new Map();
const byPhase = new Map();
const byHero = new Map();
const byActionType = new Map();
let futureTestRowCount = 0;
let regeneratedMergedMismatchCount = 0;
let missingSnapshotCount = 0;
let selectedRowCount = 0;
let behavioralEligibleRowCount = 0;
let snapshotLineageCount = new Map();

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
  if (row.split !== 'TRAIN' && row.split !== 'TUNING') {
    continue;
  }
  selectedRowCount += 1;
  if (row.eligibility?.behavioralModel === true) behavioralEligibleRowCount += 1;

  const policySha = row.versions?.candidateGeneratorPolicySha256;
  const catalogSha = row.versions?.catalogSha256;
  const artifact = artifactByLineage.get(lineageKey(policySha, catalogSha));
  if (!artifact) {
    missingSnapshotCount += 1;
    continue;
  }
  increment(snapshotLineageCount, artifact.snapshot.snapshotId);

  const policyValue = artifact.policies.find((value) => value.heroId === row.state.heroId);
  const policyCacheKey = `${artifact.snapshot.snapshotId}:${row.state.heroId}`;
  let preparedPolicy = preparedPolicies.get(policyCacheKey);
  if (!preparedPolicy && policyValue) {
    preparedPolicy = prepareRecommendationSerializedHeroBuildPolicy(policyValue);
    preparedPolicies.set(policyCacheKey, preparedPolicy);
  }

  const result = generateRecommendationBehavioralV6ChoiceSetProvenance({
    decision: datasetRowToReplayDecision(row),
    snapshot: artifact.snapshot,
    generatorOptions: artifact.generatorOptions,
    catalog: artifact.catalog,
    policy: preparedPolicy,
  });

  const regeneratedKeys = result.mergedCandidates.map((entry) => entry.candidate.actionKey);
  const storedKeys = row.candidates.map((candidate) => candidate.actionKey);
  if (!sameArray(regeneratedKeys, storedKeys)) {
    regeneratedMergedMismatchCount += 1;
  }

  const observedKey = row.observedActionKey;
  const observedStored = row.candidates.find((candidate) => candidate.actionKey === observedKey);
  const measurement = measureChoiceSet({
    observedKey,
    primaryCandidates: result.primaryCandidates,
    supportCandidates: result.supportCandidates,
    mergedCandidates: result.mergedCandidates,
    storedCandidateCount: row.candidates.length,
    observedStored,
  });
  observe(totals, measurement);
  observeMap(byTimeBucket, timeBucket(row.state.gameTimeS), measurement);
  observeMap(byEconomyBand, economyBand(row.state.netWorth), measurement);
  observeMap(byPhase, String(row.state.phase ?? 'UNKNOWN'), measurement);
  observeMap(byHero, String(row.state.heroId), measurement);
  observeMap(byActionType, actionType(observedKey), measurement);
}

const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_AUDIT',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  choiceSetVersion: RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_VERSION,
  source: {
    sampleSha256: actualSampleSha256,
    selectedRowCount,
    behavioralEligibleRowCount,
    futureTestRowCount,
    snapshotArtifactCount: artifacts.length,
    missingSnapshotCount,
    snapshotLineageCount: sortedObject(snapshotLineageCount),
  },
  structural: {
    regeneratedMergedMismatchCount,
    mergedMatchesStoredDataset: regeneratedMergedMismatchCount === 0,
    allSnapshotsResolved: missingSnapshotCount === 0,
  },
  overall: finalize(totals),
  byTimeBucket: finalizeMap(byTimeBucket),
  byEconomyBand: finalizeMap(byEconomyBand),
  byPhase: finalizeMap(byPhase),
  byHero: finalizeMap(byHero),
  byActionType: finalizeMap(byActionType),
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

function measureChoiceSet(input) {
  const primaryIndex = input.primaryCandidates.findIndex((candidate) => candidate.actionKey === input.observedKey);
  const supportIndex = input.supportCandidates.findIndex((candidate) => candidate.actionKey === input.observedKey);
  const mergedIndex = input.mergedCandidates.findIndex((entry) => entry.candidate.actionKey === input.observedKey);
  return {
    primaryCandidateCount: input.primaryCandidates.length,
    supportCandidateCount: input.supportCandidates.length,
    mergedCandidateCount: input.mergedCandidates.length,
    storedCandidateCount: input.storedCandidateCount,
    primaryObserved: primaryIndex >= 0,
    supportObserved: supportIndex >= 0,
    mergedObserved: mergedIndex >= 0,
    supportUnionOnlyObserved: primaryIndex < 0 && mergedIndex >= 0,
    primaryObservedRank: primaryIndex >= 0 ? primaryIndex + 1 : undefined,
    supportObservedRank: supportIndex >= 0 ? supportIndex + 1 : undefined,
    mergedObservedRank: mergedIndex >= 0 ? mergedIndex + 1 : undefined,
    historicalProbability: finite(input.observedStored?.historicalProbability),
    generatorScore: finite(input.observedStored?.generatorScore),
  };
}

function emptyAccumulator() {
  return {
    decisions: 0,
    primaryObserved: 0,
    supportObserved: 0,
    mergedObserved: 0,
    supportUnionOnlyObserved: 0,
    primaryCandidateCounts: [],
    supportCandidateCounts: [],
    mergedCandidateCounts: [],
    primaryObservedRanks: [],
    supportObservedRanks: [],
    mergedObservedRanks: [],
    historicalProbabilityGe001: 0,
    generatorScorePositive: 0,
  };
}

function observe(acc, value) {
  acc.decisions += 1;
  acc.primaryObserved += value.primaryObserved ? 1 : 0;
  acc.supportObserved += value.supportObserved ? 1 : 0;
  acc.mergedObserved += value.mergedObserved ? 1 : 0;
  acc.supportUnionOnlyObserved += value.supportUnionOnlyObserved ? 1 : 0;
  acc.primaryCandidateCounts.push(value.primaryCandidateCount);
  acc.supportCandidateCounts.push(value.supportCandidateCount);
  acc.mergedCandidateCounts.push(value.mergedCandidateCount);
  if (value.primaryObservedRank !== undefined) acc.primaryObservedRanks.push(value.primaryObservedRank);
  if (value.supportObservedRank !== undefined) acc.supportObservedRanks.push(value.supportObservedRank);
  if (value.mergedObservedRank !== undefined) acc.mergedObservedRanks.push(value.mergedObservedRank);
  acc.historicalProbabilityGe001 += value.historicalProbability >= 0.01 ? 1 : 0;
  acc.generatorScorePositive += value.generatorScore > 0 ? 1 : 0;
}

function observeMap(map, key, value) {
  const acc = map.get(key) ?? emptyAccumulator();
  observe(acc, value);
  map.set(key, acc);
}

function finalize(acc) {
  return {
    decisionCount: acc.decisions,
    primaryObservedCoverage: divide(acc.primaryObserved, acc.decisions),
    supportObservedCoverage: divide(acc.supportObserved, acc.decisions),
    mergedObservedCoverage: divide(acc.mergedObserved, acc.decisions),
    supportUnionOnlyObservedRate: divide(acc.supportUnionOnlyObserved, acc.decisions),
    primaryCandidateCount: distribution(acc.primaryCandidateCounts),
    supportCandidateCount: distribution(acc.supportCandidateCounts),
    mergedCandidateCount: distribution(acc.mergedCandidateCounts),
    primaryObservedRank: distribution(acc.primaryObservedRanks),
    supportObservedRank: distribution(acc.supportObservedRanks),
    mergedObservedRank: distribution(acc.mergedObservedRanks),
    historicalProbabilitySupportAt001: divide(acc.historicalProbabilityGe001, acc.decisions),
    generatorScorePositiveRate: divide(acc.generatorScorePositive, acc.decisions),
  };
}

function finalizeMap(map) {
  return [...map.entries()]
    .map(([key, value]) => ({ key, ...finalize(value) }))
    .sort((left, right) => String(left.key).localeCompare(String(right.key), undefined, { numeric: true }));
}

async function loadArtifacts(directory) {
  const registry = JSON.parse(await readFile(join(directory, 'registry.json'), 'utf8'));
  if (!Array.isArray(registry.snapshots) || registry.snapshots.length === 0) {
    throw new Error('Candidate snapshot registry is empty.');
  }
  const results = [];
  for (const entry of registry.snapshots) {
    const value = JSON.parse(await readFile(join(directory, entry.fileName), 'utf8'));
    results.push(value);
  }
  return results;
}

function datasetRowToReplayDecision(row) {
  const observedCandidate = row.candidates.find(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  const [type, itemValue] = String(row.observedActionKey).split(':');
  return {
    schemaVersion: 1,
    decisionId: row.decisionId,
    matchId: finiteInteger(row.matchId),
    matchStartTime: row.matchStartTime,
    playerId: finiteInteger(row.playerId),
    heroId: row.state.heroId,
    team: row.state.team,
    gameTimeS: row.state.gameTimeS,
    phase: row.state.phase,
    inventoryBeforeStateKey: row.state.inventoryStateKey,
    inventoryAfterStateKey: row.state.inventoryStateKey,
    previousActionKeys: [...row.state.previousActionKeys],
    buildPrefixKey: row.state.previousActionKeys.join('|'),
    alliedHeroIds: [...row.state.alliedHeroIds],
    enemyHeroIds: [...row.state.enemyHeroIds],
    actualActionType: observedCandidate?.actionType ?? type,
    actualItemId: observedCandidate?.itemId ?? finiteInteger(itemValue),
    actualActionKey: row.observedActionKey,
    outcomeLabel: { playerWon: row.finalOutcome > 0 },
  };
}

function lineageKey(policySha, catalogSha) {
  return `${String(policySha ?? '').trim().toLowerCase()}:${String(catalogSha ?? '').trim().toLowerCase()}`;
}

function actionType(actionKey) {
  return String(actionKey).split(':')[0] || 'UNKNOWN';
}

function timeBucket(gameTimeS) {
  const start = Math.floor(Math.max(0, finite(gameTimeS)) / 300) * 5;
  return `${start}-${start + 5}m`;
}

function economyBand(netWorth) {
  const value = Number(netWorth);
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if (value < 5_000) return 'LT_5000';
  if (value < 10_000) return '5000_9999';
  if (value < 15_000) return '10000_14999';
  if (value < 20_000) return '15000_19999';
  return 'GE_20000';
}

function distribution(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
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
  return lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function finite(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function finiteInteger(value) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.trunc(result) : 0;
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function increment(map, key) {
  map.set(String(key), (map.get(String(key)) ?? 0) + 1);
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function sha256File(path) {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}
