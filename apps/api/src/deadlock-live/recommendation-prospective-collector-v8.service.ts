import { createHash, createHmac, randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  InventorySnapshotEventV8,
  MinimalMatchState,
  OverwolfLiveBatchDto,
  PlayerStateEventV8,
  RECOMMENDATION_EXPERIMENT_ASSIGNMENT_VERSION,
  RECOMMENDATION_TELEMETRY_CONTRACT_VERSION,
  RECOMMENDATION_TELEMETRY_SCHEMA_VERSION,
  RecommendationOutcomeEventV8,
  RecommendationTelemetryVersionsV8,
} from '@deadlock-live-probe/shared';
import { RecommendationRealtimeCoordinatorV8Service } from './recommendation-realtime-coordinator-v8.service';
import { RecommendationRuntimeHealthV8Service } from './recommendation-runtime-health-v8.service';
import { RecommendationTelemetryIngestV8Service } from './recommendation-telemetry-ingest-v8.service';

const PROSPECTIVE_SOURCE = 'RECOMMENDATION_PROSPECTIVE_V8' as const;
const NORMALIZER_VERSION = 'gep-canonical-v2' as const;
const DEFAULT_CLIENT_VERSION = 'overwolf-legacy-bridge-v1';
const DEFAULT_GEP_VERSION = 'deadlock-gep-current';
const DEFAULT_CANDIDATE_GENERATOR_VERSION = 'recommendation-candidate-generator-v8-prospective-v1';
const DEFAULT_MODEL_VERSION = 'pretraining-untrained-v8';
const DEFAULT_DECISION_INTERVAL_MS = 5_000;
const DEFAULT_OUTCOME_ATTRIBUTION_WINDOW_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

interface ProspectiveObservationV8 {
  clientId: string;
  matchId: string;
  playerSteamId: string;
  heroId?: number;
  teamId?: number;
  level?: number;
  soulsRaw?: number;
  health?: number;
  maxHealth?: number;
  alive?: boolean;
  itemIds: number[];
  gameTimeMs?: number;
  sourceOccurredAtMs: number;
  directShopOpportunity?: 'AVAILABLE' | 'UNAVAILABLE';
  directShopSourceField?: string;
}

interface CatalogIdentityV8 {
  clientVersion: string;
  rulesetVersion: string;
  catalogSha256: string;
}

interface LatestDecisionForOutcomeV8 {
  decisionId: string;
  decidedAtMs: number;
  gameTimeMs?: number;
  clientVersion: string;
  gepVersion: string;
  normalizerVersion: string;
  rulesetVersion: string;
  catalogSha256: string;
}

interface OutcomeCandidateV8 {
  actionKey: string;
  resultingItemIds?: number[];
}

export interface RecommendationProspectiveCollectorV8Status {
  enabled: boolean;
  runtimeMode: 'SHADOW';
  ready: boolean;
  blockers: readonly string[];
  processedObservationCount: number;
  playerStateEventCount: number;
  inventorySnapshotEventCount: number;
  decisionAttemptCount: number;
  decisionReadyCount: number;
  outcomeLinkedCount: number;
  outcomeAmbiguousCount: number;
  outcomeNoDecisionCount: number;
  heartbeatCount: number;
  lastDecisionBlockers: readonly string[];
  lastError?: string;
  lastProcessedAt?: string;
  candidateGeneratorVersion: string;
  modelVersion: string;
  directShopMappingConfigured: boolean;
}

@Injectable()
export class RecommendationProspectiveCollectorV8Service {
  private readonly logger = new Logger(RecommendationProspectiveCollectorV8Service.name);
  private processing: Promise<void> = Promise.resolve();
  private readonly lastInventorySignatureByPlayer = new Map<string, string>();
  private readonly lastDecisionAtByPlayer = new Map<string, number>();
  private readonly lastHeartbeatAtByPlayer = new Map<string, number>();
  private processedObservationCount = 0;
  private playerStateEventCount = 0;
  private inventorySnapshotEventCount = 0;
  private decisionAttemptCount = 0;
  private decisionReadyCount = 0;
  private outcomeLinkedCount = 0;
  private outcomeAmbiguousCount = 0;
  private outcomeNoDecisionCount = 0;
  private heartbeatCount = 0;
  private lastDecisionBlockers: string[] = [];
  private lastError?: string;
  private lastProcessedAt?: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly telemetryIngest: RecommendationTelemetryIngestV8Service,
    private readonly realtimeCoordinator: RecommendationRealtimeCoordinatorV8Service,
    private readonly runtimeHealth: RecommendationRuntimeHealthV8Service,
  ) {}

  observeBatch(batch: OverwolfLiveBatchDto, state: MinimalMatchState | undefined): void {
    const observation = this.captureObservation(batch, state);
    if (!observation) return;

    this.processing = this.processing
      .then(() => this.processObservation(observation))
      .catch((error) => {
        this.lastError = errorMessage(error);
        this.logger.error(`Prospective V8 observation failed: ${this.lastError}`);
      });
  }

  getStatus(): RecommendationProspectiveCollectorV8Status {
    const config = this.config();
    return {
      enabled: config.enabled,
      runtimeMode: 'SHADOW',
      ready: config.enabled && config.blockers.length === 0,
      blockers: config.blockers,
      processedObservationCount: this.processedObservationCount,
      playerStateEventCount: this.playerStateEventCount,
      inventorySnapshotEventCount: this.inventorySnapshotEventCount,
      decisionAttemptCount: this.decisionAttemptCount,
      decisionReadyCount: this.decisionReadyCount,
      outcomeLinkedCount: this.outcomeLinkedCount,
      outcomeAmbiguousCount: this.outcomeAmbiguousCount,
      outcomeNoDecisionCount: this.outcomeNoDecisionCount,
      heartbeatCount: this.heartbeatCount,
      lastDecisionBlockers: this.lastDecisionBlockers,
      lastError: this.lastError,
      lastProcessedAt: this.lastProcessedAt,
      candidateGeneratorVersion: config.candidateGeneratorVersion,
      modelVersion: config.modelVersion,
      directShopMappingConfigured: config.directShopMappingConfigured,
    };
  }

  private captureObservation(
    batch: OverwolfLiveBatchDto,
    state: MinimalMatchState | undefined,
  ): ProspectiveObservationV8 | undefined {
    if (!state || !state.matchId || state.matchId === 'unknown') return undefined;
    const localPlayers = Object.values(state.playersBySteamId).filter((player) => player.isLocal === true);
    if (localPlayers.length !== 1) return undefined;
    const localPlayer = localPlayers[0];
    if (!localPlayer.steamId) return undefined;

    const sourceOccurredAtMs = batch.events.reduce(
      (latest, event) => Number.isFinite(event.receivedAt) ? Math.max(latest, event.receivedAt) : latest,
      0,
    ) || Date.now();
    const directShop = this.extractDirectShopOpportunity(batch);

    return {
      clientId: batch.clientId,
      matchId: state.matchId,
      playerSteamId: localPlayer.steamId,
      heroId: localPlayer.heroId,
      teamId: localPlayer.teamId,
      level: localPlayer.level,
      soulsRaw: localPlayer.souls,
      health: localPlayer.health,
      maxHealth: localPlayer.maxHealth,
      alive: localPlayer.health !== undefined ? localPlayer.health > 0 : undefined,
      itemIds: localPlayer.items.map((item) => Number(item.id)).filter((id) => Number.isInteger(id) && id > 0),
      gameTimeMs: state.gameTimeSec !== undefined ? Math.max(0, Math.round(state.gameTimeSec * 1000)) : undefined,
      sourceOccurredAtMs,
      directShopOpportunity: directShop?.opportunity,
      directShopSourceField: directShop?.sourceField,
    };
  }

  private async processObservation(observation: ProspectiveObservationV8): Promise<void> {
    const config = this.config();
    if (!config.enabled || config.blockers.length > 0) return;

    const catalog = await this.resolveCatalogIdentity();
    if (!catalog) {
      this.lastError = 'V8_CATALOG_IDENTITY_UNAVAILABLE';
      return;
    }

    const playerKey = `p8_${createHmac('sha256', config.playerKeyHmacSecret).update(observation.playerSteamId).digest('hex')}`;
    const now = Date.now();
    const versions: RecommendationTelemetryVersionsV8 = {
      client: catalog.clientVersion || config.clientVersion,
      gep: config.gepVersion,
      normalizer: NORMALIZER_VERSION,
      ruleset: catalog.rulesetVersion,
      catalogSha256: catalog.catalogSha256,
    };
    const sourceEventBase = `${observation.clientId}:${observation.matchId}:${observation.sourceOccurredAtMs}`;
    const playerStateEvent = this.playerStateEvent(observation, playerKey, versions, sourceEventBase, now);
    const inventoryEvent = this.inventoryEvent(observation, playerKey, versions, sourceEventBase, now);

    await this.telemetryIngest.appendExternal(playerStateEvent);
    this.playerStateEventCount += 1;
    await this.telemetryIngest.appendExternal(inventoryEvent);
    this.inventorySnapshotEventCount += 1;

    const playerScope = `${observation.matchId}:${playerKey}`;
    const inventorySignature = inventorySignatureV8(observation.itemIds);
    const previousInventorySignature = this.lastInventorySignatureByPlayer.get(playerScope);
    const inventoryChanged = previousInventorySignature !== undefined && previousInventorySignature !== inventorySignature;
    this.lastInventorySignatureByPlayer.set(playerScope, inventorySignature);

    if (inventoryChanged) {
      await this.linkInventoryOutcome(observation, playerKey, inventorySignature, now);
    }

    if (now - (this.lastHeartbeatAtByPlayer.get(playerScope) ?? 0) >= config.heartbeatIntervalMs) {
      await this.runtimeHealth.emit({
        eventId: randomUUID(),
        matchId: observation.matchId,
        playerKey,
        occurredAtMs: now,
        versions,
        runtimeMode: 'SHADOW',
        healthType: 'HEARTBEAT',
        crashCountDelta: 0,
        recommendationReady: true,
        modelVersion: config.modelVersion,
      });
      this.lastHeartbeatAtByPlayer.set(playerScope, now);
      this.heartbeatCount += 1;
    }

    if (now - (this.lastDecisionAtByPlayer.get(playerScope) ?? 0) >= config.decisionIntervalMs) {
      this.decisionAttemptCount += 1;
      const decisionAtMs = Date.now();
      const decisionId = randomUUID();
      const result = await this.realtimeCoordinator.decide({
        eventId: randomUUID(),
        sourceEventId: `${sourceEventBase}:decision`,
        decisionId,
        matchId: observation.matchId,
        playerKey,
        playerSlot: 0,
        decisionAtMs,
        candidateGeneratorVersion: config.candidateGeneratorVersion,
        modelVersion: config.modelVersion,
        runtimeMode: 'SHADOW',
        experiment: {
          experimentId: 'pretraining-prospective-v8',
          arm: 'SHADOW_DATA_COLLECTION',
          assignmentUnit: 'MATCH',
          armAssignmentPropensity: 1,
          randomized: false,
          assignmentVersion: RECOMMENDATION_EXPERIMENT_ASSIGNMENT_VERSION,
          deterministicBucket: 0,
        },
        selectionMode: 'DETERMINISTIC',
        maximumAlignmentAgeMs: config.maximumAlignmentAgeMs,
        maximumHistoryEvents: config.maximumHistoryEvents,
      });
      this.lastDecisionBlockers = [...result.blockers];
      if (result.ready) this.decisionReadyCount += 1;
      this.lastDecisionAtByPlayer.set(playerScope, now);
    }

    this.processedObservationCount += 1;
    this.lastProcessedAt = new Date().toISOString();
    this.lastError = undefined;
  }

  private playerStateEvent(
    observation: ProspectiveObservationV8,
    playerKey: string,
    versions: RecommendationTelemetryVersionsV8,
    sourceEventBase: string,
    receivedAtMs: number,
  ): PlayerStateEventV8 {
    const shopOpportunity = observation.directShopOpportunity ?? 'UNKNOWN';
    return {
      schemaVersion: RECOMMENDATION_TELEMETRY_SCHEMA_VERSION,
      contractVersion: RECOMMENDATION_TELEMETRY_CONTRACT_VERSION,
      eventId: deterministicEventId(`${sourceEventBase}:player-state`),
      eventType: 'PLAYER_STATE',
      matchId: observation.matchId,
      playerKey,
      source: PROSPECTIVE_SOURCE,
      sourceEventId: `${sourceEventBase}:player-state`,
      sourceOccurredAtMs: observation.sourceOccurredAtMs,
      receivedAtMs,
      gameTimeMs: observation.gameTimeMs,
      versions,
      payload: {
        heroId: observation.heroId,
        teamId: observation.teamId,
        level: observation.level,
        soulsRaw: observation.soulsRaw,
        shopOpportunity,
        shopOpportunityProvenance: shopOpportunity === 'UNKNOWN' || !observation.directShopSourceField
          ? undefined
          : {
              type: 'DIRECT_SOURCE_SIGNAL',
              sourceField: observation.directShopSourceField,
            },
        health: observation.health,
        maxHealth: observation.maxHealth,
        alive: observation.alive,
      },
      quality: {
        directlyObserved: true,
        reconstructed: false,
        stale: false,
        alignmentAgeMs: 0,
      },
    };
  }

  private inventoryEvent(
    observation: ProspectiveObservationV8,
    playerKey: string,
    versions: RecommendationTelemetryVersionsV8,
    sourceEventBase: string,
    receivedAtMs: number,
  ): InventorySnapshotEventV8 {
    const items = [...observation.itemIds].sort((a, b) => a - b).map((itemId) => ({ itemId }));
    return {
      schemaVersion: RECOMMENDATION_TELEMETRY_SCHEMA_VERSION,
      contractVersion: RECOMMENDATION_TELEMETRY_CONTRACT_VERSION,
      eventId: deterministicEventId(`${sourceEventBase}:inventory`),
      eventType: 'INVENTORY_SNAPSHOT',
      matchId: observation.matchId,
      playerKey,
      source: PROSPECTIVE_SOURCE,
      sourceEventId: `${sourceEventBase}:inventory`,
      sourceOccurredAtMs: observation.sourceOccurredAtMs,
      receivedAtMs,
      gameTimeMs: observation.gameTimeMs,
      versions,
      payload: {
        items,
        snapshotSha256: createHash('sha256').update(JSON.stringify(items)).digest('hex'),
      },
      quality: {
        directlyObserved: true,
        reconstructed: false,
        stale: false,
        alignmentAgeMs: 0,
      },
    };
  }

  private async linkInventoryOutcome(
    observation: ProspectiveObservationV8,
    playerKey: string,
    currentInventorySignature: string,
    receivedAtMs: number,
  ): Promise<void> {
    const config = this.config();
    const decisionRows = await this.dataSource.query(
      `SELECT d."decisionId",
              EXTRACT(EPOCH FROM d."decidedAt") * 1000 AS "decidedAtMs",
              d."gameTimeMs",
              e."clientVersion",
              e."gepVersion",
              e."normalizerVersion",
              e."rulesetVersion",
              e."catalogSha256"
       FROM recommendation_decisions_v8 d
       JOIN recommendation_telemetry_events e ON e."eventId" = d."eventId"
       WHERE d."matchId" = $1
         AND d."playerKey" = $2
         AND d."decidedAt" <= $3::timestamptz
         AND d."decidedAt" >= ($3::timestamptz - ($4::text || ' milliseconds')::interval)
         AND NOT EXISTS (
           SELECT 1
           FROM recommendation_telemetry_events outcome
           WHERE outcome."eventType" = 'RECOMMENDATION_OUTCOME'
             AND outcome."matchId" = d."matchId"
             AND outcome."playerKey" = d."playerKey"
             AND outcome."payload"->>'decisionId' = d."decisionId"
             AND COALESCE(outcome."payload"->>'observedActionKey', '') <> ''
         )
       ORDER BY d."decidedAt" DESC
       LIMIT 1`,
      [
        observation.matchId,
        playerKey,
        new Date(observation.sourceOccurredAtMs).toISOString(),
        config.outcomeAttributionWindowMs,
      ],
    ) as LatestDecisionForOutcomeV8[];
    const decision = decisionRows[0];
    if (!decision) {
      this.outcomeNoDecisionCount += 1;
      return;
    }

    const candidates = await this.dataSource.query(
      `SELECT "actionKey", "resultingItemIds"
       FROM recommendation_decision_candidates_v8
       WHERE "decisionId" = $1
         AND "feasible" = TRUE
         AND "resultingItemIds" IS NOT NULL`,
      [decision.decisionId],
    ) as OutcomeCandidateV8[];
    const matching = candidates.filter((candidate) => (
      candidate.resultingItemIds !== undefined
      && inventorySignatureV8(candidate.resultingItemIds) === currentInventorySignature
    ));
    if (matching.length !== 1) {
      if (matching.length > 1) this.outcomeAmbiguousCount += 1;
      return;
    }

    const action = matching[0];
    const versions: RecommendationTelemetryVersionsV8 = {
      client: decision.clientVersion,
      gep: decision.gepVersion,
      normalizer: decision.normalizerVersion,
      ruleset: decision.rulesetVersion,
      catalogSha256: decision.catalogSha256,
    };
    const outcome: RecommendationOutcomeEventV8 = {
      schemaVersion: RECOMMENDATION_TELEMETRY_SCHEMA_VERSION,
      contractVersion: RECOMMENDATION_TELEMETRY_CONTRACT_VERSION,
      eventId: randomUUID(),
      eventType: 'RECOMMENDATION_OUTCOME',
      matchId: observation.matchId,
      playerKey,
      source: PROSPECTIVE_SOURCE,
      sourceEventId: `${decision.decisionId}:observed-inventory:${observation.sourceOccurredAtMs}`,
      sourceOccurredAtMs: observation.sourceOccurredAtMs,
      receivedAtMs,
      gameTimeMs: observation.gameTimeMs ?? decision.gameTimeMs,
      versions,
      payload: {
        decisionId: decision.decisionId,
        observedActionKey: action.actionKey,
        observedActionAtMs: observation.sourceOccurredAtMs,
      },
      quality: {
        directlyObserved: true,
        reconstructed: false,
        stale: false,
        alignmentAgeMs: Math.max(0, observation.sourceOccurredAtMs - Number(decision.decidedAtMs)),
      },
    };
    await this.telemetryIngest.appendInternal(outcome);
    this.outcomeLinkedCount += 1;
  }

  private async resolveCatalogIdentity(): Promise<CatalogIdentityV8 | undefined> {
    const rows = await this.dataSource.query(
      `SELECT COALESCE(NULLIF("clientVersion", ''), 'overwolf-legacy-bridge-v1') AS "clientVersion",
              "rulesetKey" AS "rulesetVersion",
              "payloadSha256" AS "catalogSha256"
       FROM recommendation_item_catalog_versions_v8
       WHERE "payloadSha256" ~ '^[a-fA-F0-9]{64}$'
         AND COALESCE("rulesetKey", '') <> ''
       ORDER BY "importedAt" DESC
       LIMIT 1`,
    ) as CatalogIdentityV8[];
    return rows[0];
  }

  private extractDirectShopOpportunity(
    batch: OverwolfLiveBatchDto,
  ): { opportunity: 'AVAILABLE' | 'UNAVAILABLE'; sourceField: string } | undefined {
    const config = this.config();
    if (!config.directShopMappingConfigured) return undefined;
    for (const event of batch.events) {
      const sourceField = [event.source, event.feature ?? '', event.category ?? '', event.key ?? ''].join('|');
      if (sourceField !== config.directShopSourceField) continue;
      const value = canonicalSignalValue(event.payload);
      if (value === config.directShopAvailableValue) return { opportunity: 'AVAILABLE', sourceField };
      if (value === config.directShopUnavailableValue) return { opportunity: 'UNAVAILABLE', sourceField };
    }
    return undefined;
  }

  private config() {
    const enabled = process.env.DEADLOCK_RECOMMENDATION_V8_PROSPECTIVE_ENABLED === 'true';
    const playerKeyHmacSecret = process.env.DEADLOCK_RECOMMENDATION_V8_PLAYER_KEY_HMAC_SECRET?.trim() ?? '';
    const candidateGeneratorVersion = process.env.DEADLOCK_RECOMMENDATION_V8_CANDIDATE_GENERATOR_VERSION?.trim()
      || DEFAULT_CANDIDATE_GENERATOR_VERSION;
    const modelVersion = process.env.DEADLOCK_RECOMMENDATION_V8_MODEL_VERSION?.trim() || DEFAULT_MODEL_VERSION;
    const clientVersion = process.env.DEADLOCK_RECOMMENDATION_V8_CLIENT_VERSION?.trim() || DEFAULT_CLIENT_VERSION;
    const gepVersion = process.env.DEADLOCK_RECOMMENDATION_V8_GEP_VERSION?.trim() || DEFAULT_GEP_VERSION;
    const decisionIntervalMs = positiveInteger(
      process.env.DEADLOCK_RECOMMENDATION_V8_DECISION_INTERVAL_MS,
      DEFAULT_DECISION_INTERVAL_MS,
    );
    const outcomeAttributionWindowMs = positiveInteger(
      process.env.DEADLOCK_RECOMMENDATION_V8_OUTCOME_ATTRIBUTION_WINDOW_MS,
      DEFAULT_OUTCOME_ATTRIBUTION_WINDOW_MS,
    );
    const heartbeatIntervalMs = positiveInteger(
      process.env.DEADLOCK_RECOMMENDATION_V8_HEARTBEAT_INTERVAL_MS,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
    );
    const maximumAlignmentAgeMs = positiveInteger(
      process.env.DEADLOCK_RECOMMENDATION_V8_MAX_ALIGNMENT_AGE_MS,
      5_000,
    );
    const maximumHistoryEvents = nonNegativeInteger(
      process.env.DEADLOCK_RECOMMENDATION_V8_MAX_HISTORY_EVENTS,
      64,
    );
    const directShopSourceField = process.env.DEADLOCK_RECOMMENDATION_V8_DIRECT_SHOP_SOURCE_FIELD?.trim();
    const directShopAvailableValue = process.env.DEADLOCK_RECOMMENDATION_V8_DIRECT_SHOP_AVAILABLE_VALUE?.trim();
    const directShopUnavailableValue = process.env.DEADLOCK_RECOMMENDATION_V8_DIRECT_SHOP_UNAVAILABLE_VALUE?.trim();
    const directShopConfiguredCount = Number(Boolean(directShopSourceField))
      + Number(Boolean(directShopAvailableValue))
      + Number(Boolean(directShopUnavailableValue));
    const directShopMappingConfigured = directShopConfiguredCount === 3;
    const blockers: string[] = [];
    if (enabled && playerKeyHmacSecret.length < 32) blockers.push('PLAYER_KEY_HMAC_SECRET_MISSING_OR_TOO_SHORT');
    if (!candidateGeneratorVersion) blockers.push('CANDIDATE_GENERATOR_VERSION_REQUIRED');
    if (!modelVersion) blockers.push('MODEL_VERSION_REQUIRED');
    if (directShopConfiguredCount !== 0 && directShopConfiguredCount !== 3) blockers.push('DIRECT_SHOP_MAPPING_INCOMPLETE');
    if (directShopMappingConfigured && directShopAvailableValue === directShopUnavailableValue) {
      blockers.push('DIRECT_SHOP_MAPPING_VALUES_MUST_DIFFER');
    }
    if (process.env.DEADLOCK_RECOMMENDATION_V8_RUNTIME_MODE === 'LIVE') {
      blockers.push('PROSPECTIVE_COLLECTOR_FORBIDS_LIVE_RUNTIME');
    }
    return {
      enabled,
      playerKeyHmacSecret,
      candidateGeneratorVersion,
      modelVersion,
      clientVersion,
      gepVersion,
      decisionIntervalMs,
      outcomeAttributionWindowMs,
      heartbeatIntervalMs,
      maximumAlignmentAgeMs,
      maximumHistoryEvents,
      directShopSourceField,
      directShopAvailableValue,
      directShopUnavailableValue,
      directShopMappingConfigured,
      blockers: [...new Set(blockers)].sort(),
    };
  }
}

function inventorySignatureV8(itemIds: readonly number[]): string {
  return [...itemIds]
    .map(Number)
    .filter((itemId) => Number.isInteger(itemId) && itemId > 0)
    .sort((a, b) => a - b)
    .join(',');
}

function deterministicEventId(key: string): string {
  return `v8_${createHash('sha256').update(key).digest('hex').slice(0, 60)}`;
}

function canonicalSignalValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return canonicalJson(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
