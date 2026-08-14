import type { HeroBuildDecisionDatasetV3Row } from './hero-build-decision-dataset-v3.service';
import type {
  HeroBuildRecommendationAction,
  HeroBuildRecommendationResponse,
} from './hero-build-recommendation.service';
import {
  assertNoUserLiveContamination,
  assertRecommendationArtifactSources,
  type RecommendationDataSourceCounts,
} from './recommendation-data-provenance';

export const RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION = 1;
export const RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION =
  'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2' as const;

const DIRECT_PLAYER_IDENTITY_SOURCE = 'MATCH_PLAYER_ACCOUNT_ID_DIRECT' as const;
const MAX_ACCOUNT_ID = 0xffffffff;

export interface RecommendationHistoricalProReplayThresholds {
  minimumTimelineCoverage: number;
  minimumCandidateMetadataCoverage: number;
  minimumObservedActionCandidateCoverage: number;
}

export const DEFAULT_RECOMMENDATION_HISTORICAL_PRO_REPLAY_THRESHOLDS:
  RecommendationHistoricalProReplayThresholds = {
    minimumTimelineCoverage: 0.99,
    minimumCandidateMetadataCoverage: 0.999,
    minimumObservedActionCandidateCoverage: 0.995,
  };

export interface RecommendationFrozenCandidateGeneratorSnapshot {
  snapshotId: string;
  generatorVersion: string;
  policyVersion: string;
  policySha256: string;
  catalogVersion: string;
  catalogSha256: string;
  trainingWindowStart: string;
  trainingWindowEnd: string;
}

export interface RecommendationHistoricalCatalogItem {
  itemId: number;
  name?: string;
  cost: number;
  tier: number;
  slotType: string;
  itemType?: string;
  isActiveItem?: boolean;
  activationType?: string;
  tags: string[];
  componentItemIds: number[];
}

export interface RecommendationHistoricalCandidateInput {
  actionKey: string;
  actionType: 'BUY' | 'REBUY' | 'UPGRADE' | 'SELL';
  itemId: number;
  rank: number;
  score: number;
  historicalCount: number;
  historicalProbability: number;
  confidence: number;
  predictedStateKey: string;
}

export interface RecommendationHistoricalShortHorizonOutcome {
  horizon: '3m' | '5m' | '10m';
  complete: boolean;
  utility?: number;
  outcomeSource?: 'TIMELINE_SNAPSHOT' | 'TERMINAL_FINAL_OUTCOME';
  snapshotGameTimeS?: number;
  terminalGameTimeS?: number;
}

export interface RecommendationHistoricalReplayCandidate {
  actionKey: string;
  actionType: RecommendationHistoricalCandidateInput['actionType'];
  itemId: number;
  rank: number;
  generatorScore: number;
  historicalCount: number;
  historicalProbability: number;
  confidence: number;
  predictedStateKey: string;
  catalogMetadataAvailable: boolean;
  catalog?: RecommendationHistoricalCatalogItem;
}

export interface RecommendationHistoricalProReplayEligibility {
  stateModel: boolean;
  behavioralModel: boolean;
  actionModel: boolean;
  exclusionReasons: string[];
}

export interface RecommendationHistoricalProReplayRow {
  schemaVersion: typeof RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION;
  replayVersion: typeof RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION;
  dataSource: 'PRO_HISTORICAL';
  decisionId: string;
  matchId: string;
  matchStartTime: string;
  playerId: string;
  accountId?: string;
  playerIdentitySource?: typeof DIRECT_PLAYER_IDENTITY_SOURCE;
  heroId: number;
  team: number;
  decisionGameTimeS: number;
  phase: HeroBuildDecisionDatasetV3Row['phase'];
  timeline?: {
    decisionSnapshotJoined: boolean;
  };
  state: {
    inventoryBeforeStateKey: string;
    previousActionKeys: string[];
    buildPrefixKey: string;
    alliedHeroIds: number[];
    enemyHeroIds: number[];
  };
  observedAction: {
    actionType: HeroBuildDecisionDatasetV3Row['actualActionType'];
    itemId: number;
    actionKey: string;
    inCandidateSet: boolean;
  };
  candidates: RecommendationHistoricalReplayCandidate[];
  shortHorizonOutcomes: RecommendationHistoricalShortHorizonOutcome[];
  finalOutcomeAuxiliary: {
    playerWon: boolean;
  };
  generatorSnapshot: RecommendationFrozenCandidateGeneratorSnapshot;
  eligibility: RecommendationHistoricalProReplayEligibility;
}

export interface RecommendationHistoricalProReplayAudit {
  schemaVersion: typeof RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION;
  replayVersion: typeof RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION;
  generatedAt: string;
  passed: boolean;
  rowCount: number;
  sourceCounts: RecommendationDataSourceCounts;
  integrity: {
    duplicateDecisionIdCount: number;
    emptyCandidateSetCount: number;
    nonDeterministicCandidateOrderCount: number;
    observedActionInjectedCount: number;
    snapshotLeakageCount: number;
  };
  coverage: {
    timelineRowCount: number;
    timelineCoverage: number;
    candidateCount: number;
    candidateWithMetadataCount: number;
    candidateMetadataCoverage: number;
    observedActionInCandidateSetCount: number;
    observedActionCandidateCoverage: number;
    stateModelEligibleCount: number;
    behavioralModelEligibleCount: number;
    actionModelEligibleCount: number;
  };
  thresholds: RecommendationHistoricalProReplayThresholds;
  reasons: string[];
}

export interface CreateRecommendationHistoricalProReplayRowInput {
  decision: HeroBuildDecisionDatasetV3Row;
  decisionTimelineJoined?: boolean;
  candidateActions: RecommendationHistoricalCandidateInput[];
  catalogItemsById: ReadonlyMap<number, RecommendationHistoricalCatalogItem>;
  shortHorizonOutcomes: RecommendationHistoricalShortHorizonOutcome[];
  generatorSnapshot: RecommendationFrozenCandidateGeneratorSnapshot;
}

export function candidateActionsFromRecommendationResponse(
  response: HeroBuildRecommendationResponse,
): RecommendationHistoricalCandidateInput[] {
  const actions = [response.action, ...response.alternatives];
  const unique = new Map<string, RecommendationHistoricalCandidateInput>();

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const candidate = historicalCandidateFromRecommendationAction(
      action,
      index + 1,
    );
    if (!candidate || unique.has(candidate.actionKey)) {
      continue;
    }
    unique.set(candidate.actionKey, candidate);
  }

  return [...unique.values()];
}

export function createRecommendationHistoricalProReplayRow(
  input: CreateRecommendationHistoricalProReplayRowInput,
): RecommendationHistoricalProReplayRow {
  validateDecision(input.decision);
  validateGeneratorSnapshot(input.generatorSnapshot);
  assertSnapshotPrecedesDecision(input.generatorSnapshot, input.decision);

  const candidates = normalizeCandidates(
    input.candidateActions,
    input.catalogItemsById,
  );
  const observedActionInCandidateSet = candidates.some(
    (candidate) => candidate.actionKey === input.decision.actualActionKey,
  );
  const normalizedOutcomes = normalizeOutcomes(input.shortHorizonOutcomes);
  const completeOutcomeAvailable = normalizedOutcomes.some(
    (outcome) => outcome.complete && outcome.utility !== undefined,
  );
  const decisionTimelineJoined =
    input.decisionTimelineJoined ?? completeOutcomeAvailable;
  const allCandidateMetadataAvailable =
    candidates.length > 0 &&
    candidates.every((candidate) => candidate.catalogMetadataAvailable);
  const hasChoiceSet = candidates.length >= 2;
  const exclusionReasons: string[] = [];

  if (!decisionTimelineJoined) {
    exclusionReasons.push('MISSING_DECISION_TIMELINE_SNAPSHOT');
  }
  if (!completeOutcomeAvailable) {
    exclusionReasons.push('MISSING_COMPLETE_SHORT_HORIZON_OUTCOME');
  }
  if (candidates.length === 0) {
    exclusionReasons.push('EMPTY_CANDIDATE_SET');
  }
  if (!hasChoiceSet && candidates.length > 0) {
    exclusionReasons.push('CANDIDATE_SET_HAS_FEWER_THAN_TWO_ACTIONS');
  }
  if (!observedActionInCandidateSet) {
    exclusionReasons.push('OBSERVED_ACTION_OUTSIDE_CANDIDATE_SET');
  }
  if (!allCandidateMetadataAvailable) {
    exclusionReasons.push('INCOMPLETE_CANDIDATE_METADATA');
  }

  const behavioralModel =
    hasChoiceSet &&
    observedActionInCandidateSet &&
    allCandidateMetadataAvailable;
  const actionModel = behavioralModel && completeOutcomeAvailable;

  return {
    schemaVersion: RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION,
    replayVersion: RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION,
    dataSource: 'PRO_HISTORICAL',
    decisionId: input.decision.decisionId,
    matchId: String(input.decision.matchId),
    matchStartTime: input.decision.matchStartTime,
    playerId: String(input.decision.playerId),
    ...(input.decision.accountId === undefined
      ? {}
      : {
          accountId: input.decision.accountId,
          playerIdentitySource: input.decision.playerIdentitySource,
        }),
    heroId: input.decision.heroId,
    team: input.decision.team,
    decisionGameTimeS: input.decision.gameTimeS,
    phase: input.decision.phase,
    timeline: {
      decisionSnapshotJoined: decisionTimelineJoined,
    },
    state: {
      inventoryBeforeStateKey: input.decision.inventoryBeforeStateKey,
      previousActionKeys: [...input.decision.previousActionKeys],
      buildPrefixKey: input.decision.buildPrefixKey,
      alliedHeroIds: [...input.decision.alliedHeroIds],
      enemyHeroIds: [...input.decision.enemyHeroIds],
    },
    observedAction: {
      actionType: input.decision.actualActionType,
      itemId: input.decision.actualItemId,
      actionKey: input.decision.actualActionKey,
      inCandidateSet: observedActionInCandidateSet,
    },
    candidates,
    shortHorizonOutcomes: normalizedOutcomes,
    finalOutcomeAuxiliary: {
      playerWon: input.decision.outcomeLabel.playerWon,
    },
    generatorSnapshot: cloneSnapshot(input.generatorSnapshot),
    eligibility: {
      stateModel: completeOutcomeAvailable,
      behavioralModel,
      actionModel,
      exclusionReasons,
    },
  };
}

export function buildRecommendationHistoricalProReplayAudit(
  rows: readonly RecommendationHistoricalProReplayRow[],
  thresholds: RecommendationHistoricalProReplayThresholds =
    DEFAULT_RECOMMENDATION_HISTORICAL_PRO_REPLAY_THRESHOLDS,
  generatedAt = new Date().toISOString(),
): RecommendationHistoricalProReplayAudit {
  validateThresholds(thresholds);
  const decisionIds = new Set<string>();
  let duplicateDecisionIdCount = 0;
  let emptyCandidateSetCount = 0;
  let nonDeterministicCandidateOrderCount = 0;
  let snapshotLeakageCount = 0;
  let timelineRowCount = 0;
  let candidateCount = 0;
  let candidateWithMetadataCount = 0;
  let observedActionInCandidateSetCount = 0;
  let stateModelEligibleCount = 0;
  let behavioralModelEligibleCount = 0;
  let actionModelEligibleCount = 0;

  for (const row of rows) {
    if (decisionIds.has(row.decisionId)) {
      duplicateDecisionIdCount += 1;
    }
    decisionIds.add(row.decisionId);
    emptyCandidateSetCount += row.candidates.length === 0 ? 1 : 0;
    nonDeterministicCandidateOrderCount += isDeterministicCandidateOrder(
      row.candidates,
    )
      ? 0
      : 1;
    snapshotLeakageCount += snapshotPrecedesDecision(
      row.generatorSnapshot,
      row.matchStartTime,
    )
      ? 0
      : 1;
    const timelineOrTerminalOutcomeAvailable =
      row.timeline?.decisionSnapshotJoined === true ||
      row.shortHorizonOutcomes.some((outcome) => outcome.complete);
    timelineRowCount += timelineOrTerminalOutcomeAvailable ? 1 : 0;
    candidateCount += row.candidates.length;
    candidateWithMetadataCount += row.candidates.filter(
      (candidate) => candidate.catalogMetadataAvailable,
    ).length;
    observedActionInCandidateSetCount += row.observedAction.inCandidateSet
      ? 1
      : 0;
    stateModelEligibleCount += row.eligibility.stateModel ? 1 : 0;
    behavioralModelEligibleCount += row.eligibility.behavioralModel ? 1 : 0;
    actionModelEligibleCount += row.eligibility.actionModel ? 1 : 0;
  }

  const sourceCounts: RecommendationDataSourceCounts = {
    PRO_HISTORICAL: rows.length,
    PRO_FUTURE_HOLDOUT: 0,
    USER_LIVE: 0,
  };
  assertNoUserLiveContamination({
    artifactName: 'Recommendation Historical Pro Replay',
    sourceCounts,
  });
  assertRecommendationArtifactSources({
    artifactName: 'Recommendation Historical Pro Replay',
    purpose: 'PRO_VALUE_TRAIN',
    sourceCounts,
  });

  const timelineCoverage = ratio(timelineRowCount, rows.length);
  const candidateMetadataCoverage = ratio(
    candidateWithMetadataCount,
    candidateCount,
  );
  const observedActionCandidateCoverage = ratio(
    observedActionInCandidateSetCount,
    rows.length,
  );
  const reasons: string[] = [];

  if (rows.length === 0) {
    reasons.push('Replay contains no rows.');
  }
  if (duplicateDecisionIdCount > 0) {
    reasons.push('Replay contains duplicate decision IDs.');
  }
  if (nonDeterministicCandidateOrderCount > 0) {
    reasons.push('Replay contains non-deterministic candidate ordering.');
  }
  if (snapshotLeakageCount > 0) {
    reasons.push('A generator snapshot overlaps or follows a replay decision.');
  }
  if (timelineCoverage < thresholds.minimumTimelineCoverage) {
    reasons.push(
      `Timeline coverage ${timelineCoverage} is below ` +
        `${thresholds.minimumTimelineCoverage}.`,
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
    observedActionCandidateCoverage <
    thresholds.minimumObservedActionCandidateCoverage
  ) {
    reasons.push(
      `Observed-action candidate coverage ${observedActionCandidateCoverage} ` +
        `is below ${thresholds.minimumObservedActionCandidateCoverage}.`,
    );
  }

  return {
    schemaVersion: RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION,
    replayVersion: RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION,
    generatedAt,
    passed: reasons.length === 0,
    rowCount: rows.length,
    sourceCounts,
    integrity: {
      duplicateDecisionIdCount,
      emptyCandidateSetCount,
      nonDeterministicCandidateOrderCount,
      observedActionInjectedCount: 0,
      snapshotLeakageCount,
    },
    coverage: {
      timelineRowCount,
      timelineCoverage,
      candidateCount,
      candidateWithMetadataCount,
      candidateMetadataCoverage,
      observedActionInCandidateSetCount,
      observedActionCandidateCoverage,
      stateModelEligibleCount,
      behavioralModelEligibleCount,
      actionModelEligibleCount,
    },
    thresholds: { ...thresholds },
    reasons,
  };
}

function historicalCandidateFromRecommendationAction(
  action: HeroBuildRecommendationAction,
  rank: number,
): RecommendationHistoricalCandidateInput | undefined {
  if (
    action.type === 'HOLD' ||
    action.itemId === undefined ||
    action.sourceActionType === undefined
  ) {
    return undefined;
  }
  if (
    action.sourceActionType !== 'BUY' &&
    action.sourceActionType !== 'REBUY' &&
    action.sourceActionType !== 'UPGRADE' &&
    action.sourceActionType !== 'SELL'
  ) {
    return undefined;
  }

  return {
    actionKey: `${action.sourceActionType}:${action.itemId}`,
    actionType: action.sourceActionType,
    itemId: action.itemId,
    rank,
    score: finiteNumber(action.score, 'candidate score'),
    historicalCount: nonNegativeInteger(
      action.historicalCount,
      'candidate historicalCount',
    ),
    historicalProbability: probability(
      action.historicalProbability,
      'candidate historicalProbability',
    ),
    confidence: probability(action.confidence, 'candidate confidence'),
    predictedStateKey: requiredText(
      action.predictedStateKey,
      'candidate predictedStateKey',
    ),
  };
}

function normalizeCandidates(
  candidates: readonly RecommendationHistoricalCandidateInput[],
  catalogItemsById: ReadonlyMap<number, RecommendationHistoricalCatalogItem>,
): RecommendationHistoricalReplayCandidate[] {
  const unique = new Map<string, RecommendationHistoricalReplayCandidate>();
  const sorted = [...candidates].sort(compareCandidateInputs);

  for (const candidate of sorted) {
    validateCandidateInput(candidate);
    if (unique.has(candidate.actionKey)) {
      continue;
    }
    const catalog = catalogItemsById.get(candidate.itemId);
    unique.set(candidate.actionKey, {
      actionKey: candidate.actionKey,
      actionType: candidate.actionType,
      itemId: candidate.itemId,
      rank: unique.size + 1,
      generatorScore: candidate.score,
      historicalCount: candidate.historicalCount,
      historicalProbability: candidate.historicalProbability,
      confidence: candidate.confidence,
      predictedStateKey: candidate.predictedStateKey,
      catalogMetadataAvailable: catalog !== undefined,
    });
  }

  return [...unique.values()];
}

function normalizeOutcomes(
  outcomes: readonly RecommendationHistoricalShortHorizonOutcome[],
): RecommendationHistoricalShortHorizonOutcome[] {
  const byHorizon = new Map<
    RecommendationHistoricalShortHorizonOutcome['horizon'],
    RecommendationHistoricalShortHorizonOutcome
  >();

  for (const outcome of outcomes) {
    if (byHorizon.has(outcome.horizon)) {
      throw new Error(`Duplicate ${outcome.horizon} short-horizon outcome.`);
    }
    if (outcome.complete && outcome.utility === undefined) {
      throw new Error(
        `Complete ${outcome.horizon} outcome requires finite utility.`,
      );
    }
    if (outcome.utility !== undefined) {
      finiteNumber(outcome.utility, `${outcome.horizon} utility`);
    }
    if (outcome.snapshotGameTimeS !== undefined) {
      nonNegativeFiniteNumber(
        outcome.snapshotGameTimeS,
        `${outcome.horizon} snapshotGameTimeS`,
      );
    }
    if (outcome.terminalGameTimeS !== undefined) {
      nonNegativeFiniteNumber(
        outcome.terminalGameTimeS,
        `${outcome.horizon} terminalGameTimeS`,
      );
    }
    if (outcome.outcomeSource === 'TERMINAL_FINAL_OUTCOME') {
      if (
        !outcome.complete ||
        outcome.utility === undefined ||
        outcome.terminalGameTimeS === undefined
      ) {
        throw new Error(
          `Terminal ${outcome.horizon} outcome requires utility and terminalGameTimeS.`,
        );
      }
      if (outcome.snapshotGameTimeS !== undefined) {
        throw new Error(
          `Terminal ${outcome.horizon} outcome must not include snapshotGameTimeS.`,
        );
      }
    }
    if (
      outcome.outcomeSource === 'TIMELINE_SNAPSHOT' &&
      outcome.complete &&
      outcome.snapshotGameTimeS === undefined
    ) {
      throw new Error(
        `Timeline ${outcome.horizon} outcome requires snapshotGameTimeS.`,
      );
    }
    byHorizon.set(outcome.horizon, { ...outcome });
  }

  return (['3m', '5m', '10m'] as const).map(
    (horizon) => byHorizon.get(horizon) ?? { horizon, complete: false },
  );
}

function validateDecision(decision: HeroBuildDecisionDatasetV3Row): void {
  requiredText(decision.decisionId, 'decisionId');
  positiveInteger(decision.matchId, 'matchId');
  parseTimestamp(decision.matchStartTime, 'matchStartTime');
  positiveInteger(decision.playerId, 'playerId');
  validateDirectPlayerIdentity(
    decision.accountId,
    decision.playerIdentitySource,
    'decision',
  );
  positiveInteger(decision.heroId, 'heroId');
  nonNegativeInteger(decision.gameTimeS, 'gameTimeS');
  requiredText(decision.inventoryBeforeStateKey, 'inventoryBeforeStateKey');
  requiredText(decision.actualActionKey, 'actualActionKey');
  positiveInteger(decision.actualItemId, 'actualItemId');
}

function validateGeneratorSnapshot(
  snapshot: RecommendationFrozenCandidateGeneratorSnapshot,
): void {
  requiredText(snapshot.snapshotId, 'snapshotId');
  requiredText(snapshot.generatorVersion, 'generatorVersion');
  requiredText(snapshot.policyVersion, 'policyVersion');
  sha256(snapshot.policySha256, 'policySha256');
  requiredText(snapshot.catalogVersion, 'catalogVersion');
  sha256(snapshot.catalogSha256, 'catalogSha256');
  const start = parseTimestamp(snapshot.trainingWindowStart, 'trainingWindowStart');
  const end = parseTimestamp(snapshot.trainingWindowEnd, 'trainingWindowEnd');
  if (start.getTime() > end.getTime()) {
    throw new Error('Generator trainingWindowStart must not follow trainingWindowEnd.');
  }
}

function assertSnapshotPrecedesDecision(
  snapshot: RecommendationFrozenCandidateGeneratorSnapshot,
  decision: HeroBuildDecisionDatasetV3Row,
): void {
  if (!snapshotPrecedesDecision(snapshot, decision.matchStartTime)) {
    throw new Error(
      `Generator snapshot ${snapshot.snapshotId} is not strictly earlier than ` +
        `decision ${decision.decisionId}.`,
    );
  }
}

function snapshotPrecedesDecision(
  snapshot: RecommendationFrozenCandidateGeneratorSnapshot,
  matchStartTime: string,
): boolean {
  return (
    parseTimestamp(snapshot.trainingWindowEnd, 'trainingWindowEnd').getTime() <
    parseTimestamp(matchStartTime, 'matchStartTime').getTime()
  );
}

function validateCandidateInput(
  candidate: RecommendationHistoricalCandidateInput,
): void {
  requiredText(candidate.actionKey, 'candidate actionKey');
  positiveInteger(candidate.itemId, 'candidate itemId');
  positiveInteger(candidate.rank, 'candidate rank');
  finiteNumber(candidate.score, 'candidate score');
  nonNegativeInteger(candidate.historicalCount, 'candidate historicalCount');
  probability(
    candidate.historicalProbability,
    'candidate historicalProbability',
  );
  probability(candidate.confidence, 'candidate confidence');
  requiredText(candidate.predictedStateKey, 'candidate predictedStateKey');
}

function compareCandidateInputs(
  left: RecommendationHistoricalCandidateInput,
  right: RecommendationHistoricalCandidateInput,
): number {
  return (
    left.rank - right.rank ||
    right.score - left.score ||
    left.actionKey.localeCompare(right.actionKey)
  );
}

function isDeterministicCandidateOrder(
  candidates: readonly RecommendationHistoricalReplayCandidate[],
): boolean {
  for (let index = 0; index < candidates.length; index += 1) {
    if (candidates[index].rank !== index + 1) {
      return false;
    }
  }
  return true;
}

function validateThresholds(
  thresholds: RecommendationHistoricalProReplayThresholds,
): void {
  probability(thresholds.minimumTimelineCoverage, 'minimumTimelineCoverage');
  probability(
    thresholds.minimumCandidateMetadataCoverage,
    'minimumCandidateMetadataCoverage',
  );
  probability(
    thresholds.minimumObservedActionCandidateCoverage,
    'minimumObservedActionCandidateCoverage',
  );
}

function cloneSnapshot(
  snapshot: RecommendationFrozenCandidateGeneratorSnapshot,
): RecommendationFrozenCandidateGeneratorSnapshot {
  return { ...snapshot };
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

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function sha256(value: unknown, name: string): string {
  const normalized = requiredText(value, name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${name} must be a SHA-256 digest.`);
  }
  return normalized;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function parseTimestamp(value: unknown, name: string): Date {
  const text = requiredText(value, name);
  const timestamp = new Date(text);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${name} must be a valid timestamp.`);
  }
  return timestamp;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be finite.`);
  }
  return value;
}

function probability(value: unknown, name: string): number {
  const normalized = finiteNumber(value, name);
  if (normalized < 0 || normalized > 1) {
    throw new Error(`${name} must be between 0 and 1.`);
  }
  return normalized;
}

function nonNegativeFiniteNumber(value: unknown, name: string): number {
  const normalized = finiteNumber(value, name);
  if (normalized < 0) {
    throw new Error(`${name} must be non-negative.`);
  }
  return normalized;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return Number(value);
}
