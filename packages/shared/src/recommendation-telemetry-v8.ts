export const RECOMMENDATION_TELEMETRY_CONTRACT_VERSION = 'recommendation-telemetry-v8' as const;
export const RECOMMENDATION_TELEMETRY_SCHEMA_VERSION = 2 as const;
export const RECOMMENDATION_TELEMETRY_MAX_CLOCK_SKEW_MS = 5_000;

export type RecommendationTelemetryEventType =
  | 'PLAYER_STATE'
  | 'INVENTORY_SNAPSHOT'
  | 'RECOMMENDATION_DECISION'
  | 'RECOMMENDATION_EXPOSURE_ACK'
  | 'RECOMMENDATION_OUTCOME';

export interface RecommendationTelemetryVersionsV8 {
  client: string;
  gep: string;
  normalizer: string;
  ruleset: string;
  catalogSha256: string;
}

export interface RecommendationTelemetryQualityV8 {
  directlyObserved: boolean;
  reconstructed: boolean;
  stale: boolean;
  alignmentAgeMs: number;
}

export interface RecommendationTelemetryEnvelopeV8<TType extends RecommendationTelemetryEventType, TPayload> {
  schemaVersion: typeof RECOMMENDATION_TELEMETRY_SCHEMA_VERSION;
  contractVersion: typeof RECOMMENDATION_TELEMETRY_CONTRACT_VERSION;
  eventId: string;
  eventType: TType;
  matchId: string;
  playerKey?: string;
  source: string;
  sourceEventId?: string;
  sourceOccurredAtMs: number;
  receivedAtMs: number;
  gameTimeMs?: number;
  sequenceNo?: number;
  versions: RecommendationTelemetryVersionsV8;
  payload: TPayload;
  quality: RecommendationTelemetryQualityV8;
}

export interface VerifiedSpendableSoulsV8 {
  value: number;
  verificationContractVersion: string;
}

export interface PlayerStatePayloadV8 {
  heroId?: number;
  teamId?: number;
  level?: number;
  soulsRaw?: number;
  spendableSoulsVerified?: VerifiedSpendableSoulsV8;
  health?: number;
  maxHealth?: number;
  alive?: boolean;
}

export interface InventorySnapshotItemV8 {
  itemId: number;
  className?: string;
  slotType?: 'weapon' | 'vitality' | 'spirit';
  enhanced?: boolean;
}

export interface InventorySnapshotPayloadV8 {
  items: readonly InventorySnapshotItemV8[];
  snapshotSha256: string;
}

export type RecommendationActionTypeV8 =
  | 'WAIT_SAVE'
  | 'BUY_ITEM'
  | 'UPGRADE_ITEM'
  | 'SELL_ITEM'
  | 'REPLACE_ITEM';

export interface RecommendationDecisionCandidateV8 {
  actionKey: string;
  actionType: RecommendationActionTypeV8;
  targetItemId?: number;
  sellItemId?: number;
  recipeId?: string;
  effectiveCostSouls: number;
  feasible: boolean;
  feasibilityReasons: readonly string[];
  affordable: boolean | 'UNKNOWN';
  slotLegal: boolean | 'UNKNOWN';
  recipeLegal: boolean | 'UNKNOWN';
  shopLegal: boolean | 'UNKNOWN';
  rulesetLegal: boolean | 'UNKNOWN';
  behaviorProbability?: number;
  policyScore?: number;
  valueScore?: number;
}

export interface RecommendationExperimentAssignmentV8 {
  experimentId?: string;
  arm: string;
  assignmentUnit: 'MATCH';
  loggingPropensity: number;
  randomized: boolean;
  assignmentVersion: string;
}

export interface RecommendationDecisionPayloadV8 {
  decisionId: string;
  stateRevision: string;
  candidateGeneratorVersion: string;
  feasibleActions: readonly RecommendationDecisionCandidateV8[];
  selectedActionKey: string;
  modelVersion: string;
  policyProbability: number;
  experiment: RecommendationExperimentAssignmentV8;
  observedActionInjected: false;
}

export interface RecommendationExposureAckPayloadV8 {
  decisionId: string;
  selectedActionKey: string;
  displayedAtMs: number;
  displayOrder: readonly string[];
  ttlMs: number;
}

export interface RecommendationOutcomePayloadV8 {
  decisionId: string;
  observedActionKey?: string;
  observedActionAtMs?: number;
  recommendationAccepted?: boolean;
  economyDelta120s?: number;
  economyDelta300s?: number;
  survived120s?: boolean;
  survived300s?: boolean;
  objectiveDelta300s?: number;
  finalPlayerWon?: boolean;
}

export type PlayerStateEventV8 = RecommendationTelemetryEnvelopeV8<'PLAYER_STATE', PlayerStatePayloadV8>;
export type InventorySnapshotEventV8 = RecommendationTelemetryEnvelopeV8<'INVENTORY_SNAPSHOT', InventorySnapshotPayloadV8>;
export type RecommendationDecisionEventV8 = RecommendationTelemetryEnvelopeV8<'RECOMMENDATION_DECISION', RecommendationDecisionPayloadV8>;
export type RecommendationExposureAckEventV8 = RecommendationTelemetryEnvelopeV8<'RECOMMENDATION_EXPOSURE_ACK', RecommendationExposureAckPayloadV8>;
export type RecommendationOutcomeEventV8 = RecommendationTelemetryEnvelopeV8<'RECOMMENDATION_OUTCOME', RecommendationOutcomePayloadV8>;

export interface RecommendationTelemetryValidationV8 {
  valid: boolean;
  errors: readonly string[];
}

export function validateRecommendationTelemetryEnvelopeV8(
  event: RecommendationTelemetryEnvelopeV8<RecommendationTelemetryEventType, unknown>,
): RecommendationTelemetryValidationV8 {
  const errors: string[] = [];
  if (event.schemaVersion !== RECOMMENDATION_TELEMETRY_SCHEMA_VERSION) errors.push('SCHEMA_VERSION_MISMATCH');
  if (event.contractVersion !== RECOMMENDATION_TELEMETRY_CONTRACT_VERSION) errors.push('CONTRACT_VERSION_MISMATCH');
  if (!event.eventId) errors.push('EVENT_ID_REQUIRED');
  if (!event.matchId) errors.push('MATCH_ID_REQUIRED');
  if (!event.source) errors.push('SOURCE_REQUIRED');
  if (!Number.isFinite(event.sourceOccurredAtMs)) errors.push('SOURCE_OCCURRED_AT_INVALID');
  if (!Number.isFinite(event.receivedAtMs)) errors.push('RECEIVED_AT_INVALID');
  if (
    Number.isFinite(event.sourceOccurredAtMs)
    && Number.isFinite(event.receivedAtMs)
    && event.sourceOccurredAtMs > event.receivedAtMs + RECOMMENDATION_TELEMETRY_MAX_CLOCK_SKEW_MS
  ) {
    errors.push('SOURCE_TIMESTAMP_AFTER_RECEIVE_WINDOW');
  }
  if (event.gameTimeMs !== undefined && (!Number.isFinite(event.gameTimeMs) || event.gameTimeMs < 0)) {
    errors.push('GAME_TIME_INVALID');
  }
  if (event.sequenceNo !== undefined && (!Number.isInteger(event.sequenceNo) || event.sequenceNo < 0)) {
    errors.push('SEQUENCE_INVALID');
  }
  if (!event.versions.client) errors.push('CLIENT_VERSION_REQUIRED');
  if (!event.versions.gep) errors.push('GEP_VERSION_REQUIRED');
  if (!event.versions.normalizer) errors.push('NORMALIZER_VERSION_REQUIRED');
  if (!event.versions.ruleset) errors.push('RULESET_VERSION_REQUIRED');
  if (!isSha256(event.versions.catalogSha256)) errors.push('CATALOG_SHA256_REQUIRED');
  if (!Number.isFinite(event.quality.alignmentAgeMs) || event.quality.alignmentAgeMs < 0) errors.push('ALIGNMENT_AGE_INVALID');
  return { valid: errors.length === 0, errors };
}

export function validatePlayerStateEventV8(event: PlayerStateEventV8): RecommendationTelemetryValidationV8 {
  const errors = [...validateRecommendationTelemetryEnvelopeV8(event).errors];
  const verified = event.payload.spendableSoulsVerified;
  if (event.payload.soulsRaw !== undefined && (!Number.isFinite(event.payload.soulsRaw) || event.payload.soulsRaw < 0)) {
    errors.push('SOULS_RAW_INVALID');
  }
  if (verified) {
    if (!Number.isFinite(verified.value) || verified.value < 0) errors.push('VERIFIED_SPENDABLE_SOULS_INVALID');
    if (!verified.verificationContractVersion) errors.push('SPENDABLE_SOULS_VERIFICATION_CONTRACT_REQUIRED');
  }
  return { valid: errors.length === 0, errors };
}

export function validateRecommendationDecisionEventV8(
  event: RecommendationDecisionEventV8,
): RecommendationTelemetryValidationV8 {
  const errors = [...validateRecommendationTelemetryEnvelopeV8(event).errors];
  const payload = event.payload;
  if (!payload.decisionId) errors.push('DECISION_ID_REQUIRED');
  if (!payload.stateRevision) errors.push('STATE_REVISION_REQUIRED');
  if (!payload.candidateGeneratorVersion) errors.push('CANDIDATE_GENERATOR_VERSION_REQUIRED');
  if (!payload.modelVersion) errors.push('MODEL_VERSION_REQUIRED');
  if (payload.observedActionInjected !== false) errors.push('OBSERVED_ACTION_INJECTION_FORBIDDEN');
  if (!probability(payload.policyProbability, true)) errors.push('POLICY_PROBABILITY_INVALID');
  if (!payload.experiment.assignmentVersion) errors.push('ASSIGNMENT_VERSION_REQUIRED');
  if (payload.experiment.assignmentUnit !== 'MATCH') errors.push('ASSIGNMENT_UNIT_MUST_BE_MATCH');
  if (!probability(payload.experiment.loggingPropensity, false)) errors.push('LOGGING_PROPENSITY_INVALID');
  if (payload.experiment.randomized && !payload.experiment.experimentId) errors.push('RANDOMIZED_EXPERIMENT_ID_REQUIRED');

  const actionKeys = new Set<string>();
  for (const candidate of payload.feasibleActions) {
    if (!candidate.actionKey) errors.push('CANDIDATE_ACTION_KEY_REQUIRED');
    if (actionKeys.has(candidate.actionKey)) errors.push(`DUPLICATE_CANDIDATE:${candidate.actionKey}`);
    actionKeys.add(candidate.actionKey);
    if (!Number.isFinite(candidate.effectiveCostSouls)) errors.push(`CANDIDATE_COST_INVALID:${candidate.actionKey}`);
    if (candidate.behaviorProbability !== undefined && !probability(candidate.behaviorProbability, true)) {
      errors.push(`BEHAVIOR_PROBABILITY_INVALID:${candidate.actionKey}`);
    }
    if (candidate.feasible && candidate.actionType !== 'WAIT_SAVE') {
      if (candidate.affordable !== true) errors.push(`FEASIBLE_ACTION_AFFORDABILITY_NOT_TRUE:${candidate.actionKey}`);
      if (candidate.slotLegal !== true) errors.push(`FEASIBLE_ACTION_SLOT_LEGALITY_NOT_TRUE:${candidate.actionKey}`);
      if (candidate.recipeLegal !== true) errors.push(`FEASIBLE_ACTION_RECIPE_LEGALITY_NOT_TRUE:${candidate.actionKey}`);
      if (candidate.shopLegal !== true) errors.push(`FEASIBLE_ACTION_SHOP_LEGALITY_NOT_TRUE:${candidate.actionKey}`);
      if (candidate.rulesetLegal !== true) errors.push(`FEASIBLE_ACTION_RULESET_LEGALITY_NOT_TRUE:${candidate.actionKey}`);
    }
  }

  const selected = payload.feasibleActions.find((candidate) => candidate.actionKey === payload.selectedActionKey);
  if (!selected) errors.push('SELECTED_ACTION_NOT_IN_CANDIDATE_SET');
  else if (!selected.feasible) errors.push('SELECTED_ACTION_NOT_FEASIBLE');

  return { valid: errors.length === 0, errors };
}

export function validateRecommendationExposureAckEventV8(
  event: RecommendationExposureAckEventV8,
): RecommendationTelemetryValidationV8 {
  const errors = [...validateRecommendationTelemetryEnvelopeV8(event).errors];
  if (!event.payload.decisionId) errors.push('DECISION_ID_REQUIRED');
  if (!event.payload.selectedActionKey) errors.push('SELECTED_ACTION_KEY_REQUIRED');
  if (!Number.isFinite(event.payload.displayedAtMs)) errors.push('DISPLAYED_AT_INVALID');
  if (!Number.isFinite(event.payload.ttlMs) || event.payload.ttlMs <= 0) errors.push('TTL_INVALID');
  if (!event.payload.displayOrder.includes(event.payload.selectedActionKey)) errors.push('SELECTED_ACTION_NOT_DISPLAYED');
  return { valid: errors.length === 0, errors };
}

export function recommendationTelemetryDeduplicationKeyV8(
  event: RecommendationTelemetryEnvelopeV8<RecommendationTelemetryEventType, unknown>,
): string {
  return event.sourceEventId
    ? `${event.matchId}:${event.source}:${event.sourceEventId}`
    : `${event.matchId}:${event.source}:${event.eventId}`;
}

function probability(value: number, allowZero: boolean): boolean {
  return Number.isFinite(value) && value <= 1 && (allowZero ? value >= 0 : value > 0);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}
