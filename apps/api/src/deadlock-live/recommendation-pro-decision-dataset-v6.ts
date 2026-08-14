import type { MatchTimelinePlayerSnapshot } from './match-timeline-collector.service';
import { parseInventoryStateKey } from './hero-build-recommendation.service';
import type {
  RecommendationHistoricalCatalogItem,
  RecommendationHistoricalProReplayRow,
} from './recommendation-historical-pro-replay';

export const RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION = 1;
export const RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION =
  'RECOMMENDATION_PRO_DECISION_DATASET_V6_2' as const;
export const RECOMMENDATION_STATE_FEATURE_VERSION_V6 =
  'RECOMMENDATION_STATE_FEATURES_V6_2_FUTURE_TIMELINE_FALLBACK' as const;

const DIRECT_PLAYER_IDENTITY_SOURCE = 'MATCH_PLAYER_ACCOUNT_ID_DIRECT' as const;
const MAX_ACCOUNT_ID = 0xffffffff;

export type RecommendationDatasetV6Split =
  | 'TRAIN'
  | 'TUNING'
  | 'FUTURE_TEST';

export interface RecommendationDatasetV6Thresholds {
  minimumTimelineJoinCoverage: number;
  minimumCandidateMetadataCoverage: number;
  minimumObservedActionCandidateCoverage: number;
}

export const DEFAULT_RECOMMENDATION_DATASET_V6_THRESHOLDS:
  RecommendationDatasetV6Thresholds = {
    minimumTimelineJoinCoverage: 0.99,
    minimumCandidateMetadataCoverage: 0.999,
    minimumObservedActionCandidateCoverage: 0.995,
  };

export interface RecommendationDatasetV6InventoryItemCount {
  itemId: number;
  count: number;
}

export interface RecommendationDatasetV6StateFeatures {
  heroId: number;
  team: number;
  phase: RecommendationHistoricalProReplayRow['phase'];
  gameTimeS: number;
  inventoryStateKey: string;
  inventoryItemCounts: RecommendationDatasetV6InventoryItemCount[];
  previousActionKeys: string[];
  alliedHeroIds: number[];
  enemyHeroIds: number[];
  inventoryTagCounts: Record<string, number>;
  timelineJoined: boolean;
  timelineSnapshotGameTimeS?: number;
  timelineSnapshotLagS?: number;
  timelineSnapshotFutureFallback?: boolean;
  kills?: number;
  deaths?: number;
  assists?: number;
  netWorth?: number;
  heroDamage?: number;
  health?: number;
  maxHealth?: number;
  level?: number;
}

export interface RecommendationDatasetV6CandidateFeatures {
  actionKey: string;
  actionType: RecommendationHistoricalProReplayRow['candidates'][number]['actionType'];
  itemId: number;
  rank: number;
  generatorScore: number;
  historicalCount: number;
  historicalProbability: number;
  confidence: number;
  predictedStateKey: string;
  catalogMetadataAvailable: boolean;
  cost?: number;
  tier?: number;
  slotType?: string;
  itemType?: string;
  isActiveItem?: boolean;
  activationType?: string;
  tags: string[];
  componentItemIds: number[];
  requiredComponentCount: number;
  ownedComponentCount: number;
  missingComponentCount: number;
  hasAnyOwnedComponent: boolean;
  hasCompleteRecipeComponents: boolean;
  alreadyOwnedCount: number;
  sameSlotOwnedItemCount: number;
  inventoryTagOverlapCount: number;
  previousActionCount: number;
  currentNetWorth?: number;
  costToNetWorthRatio?: number;
}

export interface RecommendationProDecisionDatasetV6Row {
  schemaVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION;
  datasetVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION;
  dataSource: 'PRO_HISTORICAL';
  decisionSource: 'HISTORICAL_REPLAY';
  decisionId: string;
  matchId: string;
  matchStartTime: string;
  playerId: string;
  accountId?: string;
  playerIdentitySource?: typeof DIRECT_PLAYER_IDENTITY_SOURCE;
  split: RecommendationDatasetV6Split;
  state: RecommendationDatasetV6StateFeatures;
  candidates: RecommendationDatasetV6CandidateFeatures[];
  observedActionKey: string;
  observedActionInCandidateSet: boolean;
  terminalOutcomeApplied?: boolean;
  shortHorizonOutcomes: {
    threeMinutes?: number;
    fiveMinutes?: number;
    tenMinutes?: number;
  };
  finalOutcome: number;
  versions: {
    catalog: string;
    catalogSha256: string;
    candidateGenerator: string;
    candidateGeneratorPolicy: string;
    candidateGeneratorPolicySha256: string;
    stateFeatures: typeof RECOMMENDATION_STATE_FEATURE_VERSION_V6;
    replay: RecommendationHistoricalProReplayRow['replayVersion'];
  };
  eligibility: RecommendationHistoricalProReplayRow['eligibility'];
}

export interface CreateRecommendationProDecisionDatasetV6RowInput {
  replayRow: RecommendationHistoricalProReplayRow;
  split: RecommendationDatasetV6Split;
  catalogItemsById: ReadonlyMap<number, RecommendationHistoricalCatalogItem>;
  decisionTimelineSnapshot?: MatchTimelinePlayerSnapshot;
}

export interface RecommendationProDecisionDatasetV6Audit {
  schemaVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION;
  datasetVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION;
  generatedAt: string;
  passed: boolean;
  decisionCount: number;
  matchCount: number;
  candidateRowCount: number;
  duplicateDecisionCount: number;
  timelineJoinCount: number;
  timelineJoinCoverage: number;
  shortHorizonDecisionCount: number;
  shortHorizonCoverage: number;
  candidateWithMetadataCount: number;
  candidateMetadataCoverage: number;
  observedActionInCandidateSetCount: number;
  observedActionInCandidateSetCoverage: number;
  chronologicalSplitOverlapCount: number;
  chronologicalSplitOrderViolationCount: number;
  splitDistribution: Record<RecommendationDatasetV6Split, number>;
  catalogVersionDistribution: Record<string, number>;
  candidateGeneratorVersionDistribution: Record<string, number>;
  decisionSourceDistribution: Record<'HISTORICAL_REPLAY' | 'LIVE_LOG', number>;
  thresholds: RecommendationDatasetV6Thresholds;
  reasons: string[];
}

export function createRecommendationProDecisionDatasetV6Row(
  input: CreateRecommendationProDecisionDatasetV6RowInput,
): RecommendationProDecisionDatasetV6Row {
  const replayRow = input.replayRow;
  validateReplayRow(replayRow);
  validateDecisionSnapshot(replayRow, input.decisionTimelineSnapshot);

  const inventoryCounts = parseInventoryStateKey(
    replayRow.state.inventoryBeforeStateKey,
  );
  if (!inventoryCounts) {
    throw new Error(
      `Invalid replay inventory state ${replayRow.state.inventoryBeforeStateKey}.`,
    );
  }

  const inventoryItemCounts = [...inventoryCounts.entries()]
    .map(([itemId, count]) => ({ itemId, count }))
    .sort((left, right) => left.itemId - right.itemId);
  const inventoryTagCounts = buildInventoryTagCounts(
    inventoryCounts,
    input.catalogItemsById,
  );
  const snapshot = input.decisionTimelineSnapshot;
  const candidates = replayRow.candidates.map((candidate) =>
    buildCandidateFeatures({
      candidate,
      inventoryCounts,
      inventoryTagCounts,
      catalogItemsById: input.catalogItemsById,
      previousActionKeys: replayRow.state.previousActionKeys,
      currentNetWorth: snapshot?.netWorth,
    }),
  );

  return {
    schemaVersion: RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION,
    datasetVersion: RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
    dataSource: 'PRO_HISTORICAL',
    decisionSource: 'HISTORICAL_REPLAY',
    decisionId: replayRow.decisionId,
    matchId: replayRow.matchId,
    matchStartTime: replayRow.matchStartTime,
    playerId: replayRow.playerId,
    ...(replayRow.accountId === undefined
      ? {}
      : {
          accountId: replayRow.accountId,
          playerIdentitySource: replayRow.playerIdentitySource,
        }),
    split: input.split,
    state: {
      heroId: replayRow.heroId,
      team: replayRow.team,
      phase: replayRow.phase,
      gameTimeS: replayRow.decisionGameTimeS,
      inventoryStateKey: replayRow.state.inventoryBeforeStateKey,
      inventoryItemCounts,
      previousActionKeys: [...replayRow.state.previousActionKeys],
      alliedHeroIds: [...replayRow.state.alliedHeroIds],
      enemyHeroIds: [...replayRow.state.enemyHeroIds],
      inventoryTagCounts,
      timelineJoined: snapshot !== undefined,
      ...(snapshot
        ? {
            timelineSnapshotGameTimeS: snapshot.gameTimeS,
            timelineSnapshotLagS:
              replayRow.decisionGameTimeS - snapshot.gameTimeS,
            timelineSnapshotFutureFallback:
              snapshot.gameTimeS > replayRow.decisionGameTimeS,
            kills: snapshot.kills,
            deaths: snapshot.deaths,
            assists: snapshot.assists,
            netWorth: snapshot.netWorth,
            heroDamage: snapshot.heroDamage,
            ...(snapshot.health === undefined ? {} : { health: snapshot.health }),
            ...(snapshot.maxHealth === undefined
              ? {}
              : { maxHealth: snapshot.maxHealth }),
            ...(snapshot.level === undefined ? {} : { level: snapshot.level }),
          }
        : {}),
    },
    candidates,
    observedActionKey: replayRow.observedAction.actionKey,
    observedActionInCandidateSet: replayRow.observedAction.inCandidateSet,
    terminalOutcomeApplied: replayRow.shortHorizonOutcomes.some(
      (outcome) =>
        outcome.complete &&
        outcome.outcomeSource === 'TERMINAL_FINAL_OUTCOME',
    ),
    shortHorizonOutcomes: horizonOutcomes(replayRow),
    finalOutcome: replayRow.finalOutcomeAuxiliary.playerWon ? 1 : 0,
    versions: {
      catalog: replayRow.generatorSnapshot.catalogVersion,
      catalogSha256: replayRow.generatorSnapshot.catalogSha256,
      candidateGenerator: replayRow.generatorSnapshot.generatorVersion,
      candidateGeneratorPolicy: replayRow.generatorSnapshot.policyVersion,
      candidateGeneratorPolicySha256:
        replayRow.generatorSnapshot.policySha256,
      stateFeatures: RECOMMENDATION_STATE_FEATURE_VERSION_V6,
      replay: replayRow.replayVersion,
    },
    eligibility: clone(replayRow.eligibility),
  };
}

export function buildRecommendationProDecisionDatasetV6Audit(
  rows: readonly RecommendationProDecisionDatasetV6Row[],
  thresholds: RecommendationDatasetV6Thresholds =
    DEFAULT_RECOMMENDATION_DATASET_V6_THRESHOLDS,
  generatedAt = new Date().toISOString(),
): RecommendationProDecisionDatasetV6Audit {
  validateThresholds(thresholds);
  const decisionIds = new Set<string>();
  const matchIds = new Set<string>();
  const matchSplits = new Map<string, Set<RecommendationDatasetV6Split>>();
  const splitTimes = new Map<RecommendationDatasetV6Split, number[]>();
  let duplicateDecisionCount = 0;
  let candidateRowCount = 0;
  let candidateWithMetadataCount = 0;
  let timelineJoinCount = 0;
  let shortHorizonDecisionCount = 0;
  let observedActionInCandidateSetCount = 0;
  const splitDistribution = emptySplitDistribution();
  const catalogVersionDistribution: Record<string, number> = {};
  const candidateGeneratorVersionDistribution: Record<string, number> = {};
  const decisionSourceDistribution = {
    HISTORICAL_REPLAY: 0,
    LIVE_LOG: 0,
  };

  for (const row of rows) {
    validateDatasetRow(row);
    if (decisionIds.has(row.decisionId)) {
      duplicateDecisionCount += 1;
    }
    decisionIds.add(row.decisionId);
    matchIds.add(row.matchId);
    const splits = matchSplits.get(row.matchId) ?? new Set();
    splits.add(row.split);
    matchSplits.set(row.matchId, splits);
    const timestamp = Date.parse(row.matchStartTime);
    const times = splitTimes.get(row.split) ?? [];
    times.push(timestamp);
    splitTimes.set(row.split, times);
    splitDistribution[row.split] += 1;
    increment(catalogVersionDistribution, row.versions.catalog);
    increment(
      candidateGeneratorVersionDistribution,
      row.versions.candidateGenerator,
    );
    decisionSourceDistribution[row.decisionSource] += 1;
    timelineJoinCount +=
      row.state.timelineJoined || row.terminalOutcomeApplied === true ? 1 : 0;
    shortHorizonDecisionCount += hasShortHorizonOutcome(row) ? 1 : 0;
    observedActionInCandidateSetCount += row.observedActionInCandidateSet ? 1 : 0;
    candidateRowCount += row.candidates.length;
    candidateWithMetadataCount += row.candidates.filter(
      (candidate) => candidate.catalogMetadataAvailable,
    ).length;
  }

  const chronologicalSplitOverlapCount = [...matchSplits.values()].filter(
    (splits) => splits.size > 1,
  ).length;
  const chronologicalSplitOrderViolationCount = splitOrderViolationCount(
    splitTimes,
  );
  const timelineJoinCoverage = ratio(timelineJoinCount, rows.length);
  const shortHorizonCoverage = ratio(
    shortHorizonDecisionCount,
    rows.length,
  );
  const candidateMetadataCoverage = ratio(
    candidateWithMetadataCount,
    candidateRowCount,
  );
  const observedActionInCandidateSetCoverage = ratio(
    observedActionInCandidateSetCount,
    rows.length,
  );
  const reasons: string[] = [];

  if (rows.length === 0) {
    reasons.push('Dataset contains no decisions.');
  }
  if (duplicateDecisionCount > 0) {
    reasons.push('Dataset contains duplicate decision IDs.');
  }
  if (timelineJoinCoverage < thresholds.minimumTimelineJoinCoverage) {
    reasons.push(
      `Timeline join or confirmed terminal outcome coverage ${timelineJoinCoverage} is below ` +
        `${thresholds.minimumTimelineJoinCoverage}.`,
    );
  }
  if (
    candidateMetadataCoverage < thresholds.minimumCandidateMetadataCoverage
  ) {
    reasons.push(
      `Candidate metadata coverage ${candidateMetadataCoverage} is below ` +
        `${thresholds.minimumCandidateMetadataCoverage}.`,
    );
  }
  if (
    observedActionInCandidateSetCoverage <
    thresholds.minimumObservedActionCandidateCoverage
  ) {
    reasons.push(
      `Observed-action candidate coverage ` +
        `${observedActionInCandidateSetCoverage} is below ` +
        `${thresholds.minimumObservedActionCandidateCoverage}.`,
    );
  }
  if (chronologicalSplitOverlapCount > 0) {
    reasons.push('A match appears in more than one chronological split.');
  }
  if (chronologicalSplitOrderViolationCount > 0) {
    reasons.push('Chronological split time ranges overlap or are out of order.');
  }

  return {
    schemaVersion: RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION,
    datasetVersion: RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
    generatedAt,
    passed: reasons.length === 0,
    decisionCount: rows.length,
    matchCount: matchIds.size,
    candidateRowCount,
    duplicateDecisionCount,
    timelineJoinCount,
    timelineJoinCoverage,
    shortHorizonDecisionCount,
    shortHorizonCoverage,
    candidateWithMetadataCount,
    candidateMetadataCoverage,
    observedActionInCandidateSetCount,
    observedActionInCandidateSetCoverage,
    chronologicalSplitOverlapCount,
    chronologicalSplitOrderViolationCount,
    splitDistribution,
    catalogVersionDistribution: sortRecord(catalogVersionDistribution),
    candidateGeneratorVersionDistribution: sortRecord(
      candidateGeneratorVersionDistribution,
    ),
    decisionSourceDistribution,
    thresholds: { ...thresholds },
    reasons,
  };
}

function buildCandidateFeatures(input: {
  candidate: RecommendationHistoricalProReplayRow['candidates'][number];
  inventoryCounts: ReadonlyMap<number, number>;
  inventoryTagCounts: Readonly<Record<string, number>>;
  catalogItemsById: ReadonlyMap<number, RecommendationHistoricalCatalogItem>;
  previousActionKeys: readonly string[];
  currentNetWorth?: number;
}): RecommendationDatasetV6CandidateFeatures {
  const metadata =
    input.candidate.catalog ??
    input.catalogItemsById.get(input.candidate.itemId);
  const componentItemIds = metadata ? [...metadata.componentItemIds] : [];
  const requiredComponentCount = componentItemIds.length;
  const ownedComponentCount = countOwnedComponents(
    componentItemIds,
    input.inventoryCounts,
  );
  const missingComponentCount = Math.max(
    0,
    requiredComponentCount - ownedComponentCount,
  );
  const sameSlotOwnedItemCount = metadata
    ? countOwnedItemsBySlot(
        metadata.slotType,
        input.inventoryCounts,
        input.catalogItemsById,
      )
    : 0;
  const tags = metadata ? [...metadata.tags].sort() : [];
  const inventoryTagOverlapCount = tags.reduce(
    (sum, tag) => sum + (input.inventoryTagCounts[tag] ?? 0),
    0,
  );
  const currentNetWorth = input.currentNetWorth;
  const cost = metadata?.cost;

  return {
    actionKey: input.candidate.actionKey,
    actionType: input.candidate.actionType,
    itemId: input.candidate.itemId,
    rank: input.candidate.rank,
    generatorScore: input.candidate.generatorScore,
    historicalCount: input.candidate.historicalCount,
    historicalProbability: input.candidate.historicalProbability,
    confidence: input.candidate.confidence,
    predictedStateKey: input.candidate.predictedStateKey,
    catalogMetadataAvailable: input.candidate.catalogMetadataAvailable,
    ...(cost === undefined ? {} : { cost }),
    ...(metadata?.tier === undefined ? {} : { tier: metadata.tier }),
    ...(metadata?.slotType === undefined
      ? {}
      : { slotType: metadata.slotType }),
    ...(metadata?.itemType === undefined
      ? {}
      : { itemType: metadata.itemType }),
    ...(metadata?.isActiveItem === undefined
      ? {}
      : { isActiveItem: metadata.isActiveItem }),
    ...(metadata?.activationType === undefined
      ? {}
      : { activationType: metadata.activationType }),
    tags,
    componentItemIds,
    requiredComponentCount,
    ownedComponentCount,
    missingComponentCount,
    hasAnyOwnedComponent: ownedComponentCount > 0,
    hasCompleteRecipeComponents:
      requiredComponentCount > 0 && missingComponentCount === 0,
    alreadyOwnedCount: input.inventoryCounts.get(input.candidate.itemId) ?? 0,
    sameSlotOwnedItemCount,
    inventoryTagOverlapCount,
    previousActionCount: input.previousActionKeys.filter(
      (actionKey) => actionKey === input.candidate.actionKey,
    ).length,
    ...(currentNetWorth === undefined ? {} : { currentNetWorth }),
    ...(cost === undefined || currentNetWorth === undefined || currentNetWorth <= 0
      ? {}
      : { costToNetWorthRatio: cost / currentNetWorth }),
  };
}

function buildInventoryTagCounts(
  inventoryCounts: ReadonlyMap<number, number>,
  catalogItemsById: ReadonlyMap<number, RecommendationHistoricalCatalogItem>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [itemId, itemCount] of inventoryCounts) {
    const item = catalogItemsById.get(itemId);
    if (!item) {
      continue;
    }
    for (const tag of item.tags) {
      counts[tag] = (counts[tag] ?? 0) + itemCount;
    }
  }
  return sortRecord(counts);
}

function countOwnedComponents(
  componentItemIds: readonly number[],
  inventoryCounts: ReadonlyMap<number, number>,
): number {
  const remaining = new Map(inventoryCounts);
  let count = 0;
  for (const componentItemId of componentItemIds) {
    const available = remaining.get(componentItemId) ?? 0;
    if (available <= 0) {
      continue;
    }
    remaining.set(componentItemId, available - 1);
    count += 1;
  }
  return count;
}

function countOwnedItemsBySlot(
  slotType: string,
  inventoryCounts: ReadonlyMap<number, number>,
  catalogItemsById: ReadonlyMap<number, RecommendationHistoricalCatalogItem>,
): number {
  let count = 0;
  for (const [itemId, itemCount] of inventoryCounts) {
    if (catalogItemsById.get(itemId)?.slotType === slotType) {
      count += itemCount;
    }
  }
  return count;
}

function horizonOutcomes(
  replayRow: RecommendationHistoricalProReplayRow,
): RecommendationProDecisionDatasetV6Row['shortHorizonOutcomes'] {
  const result: RecommendationProDecisionDatasetV6Row['shortHorizonOutcomes'] = {};
  for (const outcome of replayRow.shortHorizonOutcomes) {
    if (!outcome.complete || outcome.utility === undefined) {
      continue;
    }
    if (outcome.horizon === '3m') {
      result.threeMinutes = outcome.utility;
    } else if (outcome.horizon === '5m') {
      result.fiveMinutes = outcome.utility;
    } else {
      result.tenMinutes = outcome.utility;
    }
  }
  return result;
}

function validateReplayRow(row: RecommendationHistoricalProReplayRow): void {
  if (!row.decisionId.trim() || !row.matchId.trim() || !row.playerId.trim()) {
    throw new Error('Replay identity fields are required.');
  }
  validateDirectPlayerIdentity(row.accountId, row.playerIdentitySource, 'Replay');
  if (row.dataSource !== 'PRO_HISTORICAL') {
    throw new Error('Dataset V6 accepts only PRO_HISTORICAL replay rows.');
  }
  if (row.candidates.length === 0) {
    throw new Error('Replay row must contain a candidate set.');
  }
  if (!Number.isFinite(Date.parse(row.matchStartTime))) {
    throw new Error('Replay matchStartTime must be a valid timestamp.');
  }
}

function validateDecisionSnapshot(
  row: RecommendationHistoricalProReplayRow,
  snapshot?: MatchTimelinePlayerSnapshot,
): void {
  if (!snapshot) {
    return;
  }
  if (String(snapshot.matchId) !== row.matchId) {
    throw new Error('Decision timeline snapshot match does not match replay row.');
  }
  if (snapshot.heroId !== row.heroId) {
    throw new Error('Decision timeline snapshot hero does not match replay row.');
  }
  if (!Number.isFinite(snapshot.gameTimeS)) {
    throw new Error('Decision timeline snapshot game time is invalid.');
  }
}

function validateDatasetRow(row: RecommendationProDecisionDatasetV6Row): void {
  if (
    row.schemaVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION ||
    row.datasetVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION
  ) {
    throw new Error('Unsupported Recommendation Dataset V6 row.');
  }
  if (row.dataSource !== 'PRO_HISTORICAL') {
    throw new Error('Recommendation Dataset V6 contains a non-pro source.');
  }
  validateDirectPlayerIdentity(
    row.accountId,
    row.playerIdentitySource,
    'Dataset V6',
  );
  if (!Number.isFinite(Date.parse(row.matchStartTime))) {
    throw new Error('Recommendation Dataset V6 contains an invalid match time.');
  }
}

function validateDirectPlayerIdentity(
  accountId: string | undefined,
  source: string | undefined,
  context: string,
): void {
  if (accountId === undefined && source === undefined) return;
  if (source !== DIRECT_PLAYER_IDENTITY_SOURCE) {
    throw new Error(
      `${context} direct player identity requires ${DIRECT_PLAYER_IDENTITY_SOURCE}.`,
    );
  }
  if (accountId === undefined || !/^[1-9]\d*$/.test(accountId)) {
    throw new Error(`${context} accountId must be a positive u32 decimal string.`);
  }
  const parsed = Number(accountId);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_ACCOUNT_ID) {
    throw new Error(`${context} accountId must be within the u32 domain.`);
  }
}

function validateThresholds(thresholds: RecommendationDatasetV6Thresholds): void {
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${name} must be between 0 and 1.`);
    }
  }
}

function hasShortHorizonOutcome(
  row: RecommendationProDecisionDatasetV6Row,
): boolean {
  return (
    row.shortHorizonOutcomes.threeMinutes !== undefined ||
    row.shortHorizonOutcomes.fiveMinutes !== undefined ||
    row.shortHorizonOutcomes.tenMinutes !== undefined
  );
}

function splitOrderViolationCount(
  splitTimes: ReadonlyMap<RecommendationDatasetV6Split, readonly number[]>,
): number {
  let count = 0;
  const trainMax = max(splitTimes.get('TRAIN'));
  const tuningMin = min(splitTimes.get('TUNING'));
  const tuningMax = max(splitTimes.get('TUNING'));
  const testMin = min(splitTimes.get('FUTURE_TEST'));
  if (trainMax !== undefined && tuningMin !== undefined && trainMax >= tuningMin) {
    count += 1;
  }
  if (tuningMax !== undefined && testMin !== undefined && tuningMax >= testMin) {
    count += 1;
  }
  return count;
}

function emptySplitDistribution(): Record<RecommendationDatasetV6Split, number> {
  return { TRAIN: 0, TUNING: 0, FUTURE_TEST: 0 };
}

function min(values?: readonly number[]): number | undefined {
  return values && values.length > 0 ? Math.min(...values) : undefined;
}

function max(values?: readonly number[]): number | undefined {
  return values && values.length > 0 ? Math.max(...values) : undefined;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
