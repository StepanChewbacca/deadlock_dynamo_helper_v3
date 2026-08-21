import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  RecommendationDecisionState,
  RecommendationItemGraph,
  buildInventoryInstancesForRecommendation,
  buildRecommendationRulesetCatalogV1,
  compileStrictRecommendationCatalogV1,
  createRecommendationItemGraph,
  observedFact,
  unknownFact,
} from '@deadlock-live-probe/build-domain';
import {
  InventorySnapshotPayloadV8,
  PlayerStatePayloadV8,
  RecommendationFeatureStateV8,
} from '@deadlock-live-probe/shared';
import { assembleRecommendationFeatureStateV8 } from './recommendation-feature-assembler-v8';

export interface RecommendationRealtimeStateV8Request {
  decisionId: string;
  matchId: string;
  playerKey: string;
  playerSlot: number;
  decisionAtMs: number;
  maximumAlignmentAgeMs?: number;
}

export interface RecommendationRealtimeStateV8Result {
  ready: boolean;
  blockers: readonly string[];
  state?: RecommendationDecisionState;
  itemGraph?: RecommendationItemGraph;
  featureState?: RecommendationFeatureStateV8;
  rulesetVersion?: string;
  catalogSha256?: string;
}

interface TelemetryRow {
  sourceOccurredAt: Date | string;
  gameTimeMs?: number;
  clientVersion: string;
  rulesetVersion: string;
  catalogSha256: string;
  payload: Record<string, unknown>;
}

interface CatalogVersionRow {
  catalogVersionId: string;
  contentCatalogVersionId?: string;
  clientVersion: string;
  rulesetId?: number | string;
  rulesetKey?: string;
  source: string;
  payloadSha256: string;
  importedAt: Date | string;
}

interface CatalogItemRow {
  itemId: string | number;
  name: string;
  className?: string;
  itemType?: string;
  slotType?: string;
  cost?: string | number;
  tier?: string | number;
  shopable?: boolean;
  disabled?: boolean;
  active?: boolean;
  isActiveItem?: boolean;
  activationType?: string;
  rawPayload?: Record<string, unknown>;
}

interface CatalogRecipeRow {
  parentItemId: string | number;
  componentItemId: string | number;
  componentOrder: string | number;
}

@Injectable()
export class RecommendationRealtimeStateV8Service {
  constructor(private readonly dataSource: DataSource) {}

  async build(request: RecommendationRealtimeStateV8Request): Promise<RecommendationRealtimeStateV8Result> {
    const requestErrors = validateRequest(request);
    if (requestErrors.length > 0) return { ready: false, blockers: requestErrors };
    const maximumAlignmentAgeMs = request.maximumAlignmentAgeMs ?? 5_000;
    const from = new Date(request.decisionAtMs - maximumAlignmentAgeMs).toISOString();
    const to = new Date(request.decisionAtMs).toISOString();
    const [playerRows, inventoryRows] = await Promise.all([
      this.dataSource.query(
        `SELECT "sourceOccurredAt", "gameTimeMs", "clientVersion", "rulesetVersion", "catalogSha256", "payload"
         FROM recommendation_telemetry_events
         WHERE "matchId" = $1
           AND "playerKey" = $2
           AND "eventType" = 'PLAYER_STATE'
           AND "sourceOccurredAt" >= $3
           AND "sourceOccurredAt" <= $4
         ORDER BY "sourceOccurredAt" DESC, "receivedAt" DESC
         LIMIT 1`,
        [request.matchId, request.playerKey, from, to],
      ),
      this.dataSource.query(
        `SELECT "sourceOccurredAt", "gameTimeMs", "clientVersion", "rulesetVersion", "catalogSha256", "payload"
         FROM recommendation_telemetry_events
         WHERE "matchId" = $1
           AND "playerKey" = $2
           AND "eventType" = 'INVENTORY_SNAPSHOT'
           AND "sourceOccurredAt" >= $3
           AND "sourceOccurredAt" <= $4
         ORDER BY "sourceOccurredAt" DESC, "receivedAt" DESC
         LIMIT 1`,
        [request.matchId, request.playerKey, from, to],
      ),
    ]) as [TelemetryRow[], TelemetryRow[]];
    const playerRow = playerRows[0];
    const inventoryRow = inventoryRows[0];
    const blockers: string[] = [];
    if (!playerRow) blockers.push('PLAYER_STATE_MISSING');
    if (!inventoryRow) blockers.push('INVENTORY_SNAPSHOT_MISSING');
    if (blockers.length > 0) return { ready: false, blockers: blockers.sort() };
    if (playerRow.rulesetVersion !== inventoryRow.rulesetVersion) blockers.push('RULESET_ALIGNMENT_MISMATCH');
    if (playerRow.catalogSha256 !== inventoryRow.catalogSha256) blockers.push('CATALOG_ALIGNMENT_MISMATCH');
    if (blockers.length > 0) return { ready: false, blockers: blockers.sort() };

    const catalog = await this.loadCatalog(playerRow.catalogSha256);
    if (!catalog) return { ready: false, blockers: ['CATALOG_VERSION_NOT_FOUND'] };
    const compiled = compileStrictRecommendationCatalogV1(catalog.catalog);
    if (compiled.itemDefinitions.length === 0) {
      return { ready: false, blockers: ['STRICT_RECOMMENDATION_CATALOG_EMPTY'] };
    }
    let itemGraph: RecommendationItemGraph;
    try {
      itemGraph = createRecommendationItemGraph(compiled.itemDefinitions);
    } catch (error) {
      return { ready: false, blockers: [`ITEM_GRAPH_INVALID:${errorMessage(error)}`] };
    }

    const playerPayload = playerRow.payload as unknown as PlayerStatePayloadV8;
    const inventoryPayload = inventoryRow.payload as unknown as InventorySnapshotPayloadV8;
    const heroId = playerPayload.heroId;
    if (heroId === undefined || !Number.isInteger(heroId) || heroId <= 0) blockers.push('HERO_ID_MISSING');
    const itemIds = inventoryPayload.items?.map((item) => item.itemId) ?? [];
    for (const itemId of itemIds) {
      if (!itemGraph.hasItem(itemId)) blockers.push(`INVENTORY_ITEM_NOT_IN_STRICT_CATALOG:${itemId}`);
    }
    if (blockers.length > 0) {
      return {
        ready: false,
        blockers: [...new Set(blockers)].sort(),
        rulesetVersion: playerRow.rulesetVersion,
        catalogSha256: playerRow.catalogSha256,
      };
    }

    const shopOpportunity = playerPayload.shopOpportunity ?? 'UNKNOWN';
    const verifiedWallet = playerPayload.spendableSoulsVerified;
    const state: RecommendationDecisionState = {
      decisionId: request.decisionId,
      matchId: request.matchId,
      playerSlot: request.playerSlot,
      gameTimeSec: ((playerRow.gameTimeMs ?? inventoryRow.gameTimeMs ?? 0) / 1000),
      rulesetId: playerRow.rulesetVersion,
      heroId: heroId as number,
      inventory: {
        initializedFromSnapshot: true,
        heldByItemId: buildInventoryInstancesForRecommendation(itemIds, itemGraph),
        lifecycleCountByItemId: new Map(),
        nextInstanceSequence: itemIds.length + 1,
      },
      economy: {
        spendableSouls: verifiedWallet
          ? observedFact(verifiedWallet.value, verifiedWallet.verificationContractVersion)
          : unknownFact('spendableSouls is not server-verified'),
        shopOpportunity: shopOpportunity === 'UNKNOWN'
          ? unknownFact('shop opportunity direct signal unavailable')
          : observedFact(shopOpportunity, 'direct shop opportunity telemetry'),
      },
    };

    const slotTypeByItemId = new Map<number, 'weapon' | 'vitality' | 'spirit'>();
    const activeItemIds = new Set<number>();
    for (const definition of compiled.itemDefinitions) {
      slotTypeByItemId.set(definition.itemId, definition.slotType);
      if (definition.active) activeItemIds.add(definition.itemId);
    }
    const featureResult = assembleRecommendationFeatureStateV8({
      decision: {
        decisionId: request.decisionId,
        matchId: request.matchId,
        playerKey: request.playerKey,
        decisionAtMs: request.decisionAtMs,
        gameTimeMs: playerRow.gameTimeMs ?? inventoryRow.gameTimeMs,
        rulesetVersion: playerRow.rulesetVersion,
        catalogSha256: playerRow.catalogSha256,
      },
      playerState: {
        sourceOccurredAtMs: new Date(playerRow.sourceOccurredAt).getTime(),
        payload: playerPayload,
      },
      inventorySnapshot: {
        sourceOccurredAtMs: new Date(inventoryRow.sourceOccurredAt).getTime(),
        payload: inventoryPayload,
      },
      slotTypeByItemId,
      activeItemIds,
      history: [],
    });
    if (!featureResult.ready || !featureResult.featureState) {
      return {
        ready: false,
        blockers: featureResult.blockers,
        rulesetVersion: playerRow.rulesetVersion,
        catalogSha256: playerRow.catalogSha256,
      };
    }
    return {
      ready: true,
      blockers: [],
      state,
      itemGraph,
      featureState: featureResult.featureState,
      rulesetVersion: playerRow.rulesetVersion,
      catalogSha256: playerRow.catalogSha256,
    };
  }

  private async loadCatalog(catalogSha256: string) {
    const versionRows = await this.dataSource.query(
      `SELECT "catalogVersionId", "contentCatalogVersionId", "clientVersion", "rulesetId", "rulesetKey", "source", "payloadSha256", "importedAt"
       FROM item_catalog_versions
       WHERE "payloadSha256" = $1
       ORDER BY "importedAt" DESC
       LIMIT 1`,
      [catalogSha256],
    ) as CatalogVersionRow[];
    const version = versionRows[0];
    if (!version) return undefined;
    const [itemRows, recipeRows] = await Promise.all([
      this.dataSource.query(
        `SELECT "itemId", "name", "className", "itemType", "slotType", "cost", "tier", "shopable", "disabled", "active", "isActiveItem", "activationType", "rawPayload"
         FROM item_catalog_items
         WHERE "catalogVersionId" = $1
         ORDER BY "itemId"`,
        [version.catalogVersionId],
      ),
      this.dataSource.query(
        `SELECT "parentItemId", "componentItemId", "componentOrder"
         FROM item_catalog_recipes
         WHERE "catalogVersionId" = $1
         ORDER BY "parentItemId", "componentOrder", "componentItemId"`,
        [version.catalogVersionId],
      ),
    ]) as [CatalogItemRow[], CatalogRecipeRow[]];
    return buildRecommendationRulesetCatalogV1({
      version: {
        catalogVersionId: version.catalogVersionId,
        contentCatalogVersionId: version.contentCatalogVersionId,
        clientVersion: version.clientVersion,
        rulesetId: version.rulesetId === undefined ? undefined : Number(version.rulesetId),
        rulesetKey: version.rulesetKey,
        source: version.source,
        payloadSha256: version.payloadSha256,
        importedAt: new Date(version.importedAt).toISOString(),
      },
      items: itemRows.map((item) => ({
        itemId: Number(item.itemId),
        name: item.name,
        className: item.className,
        itemType: item.itemType,
        slotType: item.slotType,
        cost: item.cost === undefined ? undefined : Number(item.cost),
        tier: item.tier === undefined ? undefined : Number(item.tier),
        shopable: item.shopable,
        disabled: item.disabled,
        active: item.active,
        isActiveItem: item.isActiveItem,
        activationType: item.activationType,
        rawPayload: item.rawPayload,
      })),
      recipeEdges: recipeRows.map((recipe) => ({
        parentItemId: Number(recipe.parentItemId),
        componentItemId: Number(recipe.componentItemId),
        componentOrder: Number(recipe.componentOrder),
      })),
    });
  }
}

function validateRequest(request: RecommendationRealtimeStateV8Request): string[] {
  const errors: string[] = [];
  if (!request.decisionId) errors.push('DECISION_ID_REQUIRED');
  if (!request.matchId) errors.push('MATCH_ID_REQUIRED');
  if (!request.playerKey) errors.push('PLAYER_KEY_REQUIRED');
  if (!Number.isInteger(request.playerSlot) || request.playerSlot < 0) errors.push('PLAYER_SLOT_INVALID');
  if (!Number.isFinite(request.decisionAtMs)) errors.push('DECISION_AT_INVALID');
  if (
    request.maximumAlignmentAgeMs !== undefined
    && (!Number.isInteger(request.maximumAlignmentAgeMs) || request.maximumAlignmentAgeMs < 0)
  ) errors.push('MAXIMUM_ALIGNMENT_AGE_INVALID');
  return errors.sort();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
