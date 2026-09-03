import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  InventoryState,
  RecommendationDecisionState,
  RecommendationItemGraph,
  buildInventoryInstancesForRecommendation,
  buildRecommendationRulesetCatalogV1,
  compileStrictRecommendationCatalogV1,
  observedFact,
  unknownFact,
} from '@deadlock-live-probe/build-domain';
import { MinimalMatchState, MinimalPlayerState } from '@deadlock-live-probe/shared';
import { LiveMatchStateService } from '../deadlock-live/live-match-state.service';
import { SoulsAffordabilityEvidenceV2Service } from '../deadlock-live/souls-affordability-evidence-v2.service';
import { RecommendationItemCatalogVersionV1 } from '../deadlock-live/entities/recommendation-item-catalog-version-v1.entity';
import { RecommendationItemCatalogItemV1 } from '../deadlock-live/entities/recommendation-item-catalog-item-v1.entity';
import { RecommendationItemCatalogRecipeV1 } from '../deadlock-live/entities/recommendation-item-catalog-recipe-v1.entity';
import { resolveRecommendationCatalogAssetSemantics } from '../deadlock-live/recommendation-catalog-asset-semantics';

export interface AdaptiveDecisionStateV1 {
  state: RecommendationDecisionState;
  itemGraph: RecommendationItemGraph;
  catalogVersionId: string;
  catalogSha256: string;
  rulesetId: string;
  localSteamId: string;
  enemyHeroIds: readonly number[];
  ourTeamSouls?: number;
  enemyTeamSouls?: number;
  stateRevision: string;
}

export class AdaptiveLiveStateNotReadyError extends Error {
  constructor(
    readonly matchId: string,
    readonly blocker: 'LIVE_MATCH_STATE_UNAVAILABLE' | 'LOCAL_PLAYER_UNRESOLVED' | 'LOCAL_PLAYER_IDENTITY_INCOMPLETE',
  ) {
    super(`Live state is not ready for match ${matchId}: ${blocker}`);
    this.name = 'AdaptiveLiveStateNotReadyError';
  }
}

@Injectable()
export class AdaptiveDecisionStateV1Service {
  constructor(
    private readonly liveState: LiveMatchStateService,
    private readonly soulsEvidence: SoulsAffordabilityEvidenceV2Service,
    @InjectRepository(RecommendationItemCatalogVersionV1)
    private readonly versionRepo: Repository<RecommendationItemCatalogVersionV1>,
    @InjectRepository(RecommendationItemCatalogItemV1)
    private readonly itemRepo: Repository<RecommendationItemCatalogItemV1>,
    @InjectRepository(RecommendationItemCatalogRecipeV1)
    private readonly recipeRepo: Repository<RecommendationItemCatalogRecipeV1>,
  ) {}

  async build(matchId: string, requestedLocalSteamId?: string): Promise<AdaptiveDecisionStateV1> {
    const match = this.liveState.getState(matchId);
    if (!match) throw new AdaptiveLiveStateNotReadyError(matchId, 'LIVE_MATCH_STATE_UNAVAILABLE');
    const localSteamId = resolveLocalSteamId(match, requestedLocalSteamId);
    const local = match.playersBySteamId[localSteamId];
    if (!local?.heroId || local.teamId === undefined) {
      throw new AdaptiveLiveStateNotReadyError(matchId, 'LOCAL_PLAYER_IDENTITY_INCOMPLETE');
    }

    const [version] = await this.versionRepo.find({
      order: { importedAt: 'DESC', catalogVersionId: 'DESC' },
      take: 1,
    });
    if (!version) throw new Error('No item catalog version is available');

    const [itemRows, recipeRows] = await Promise.all([
      this.itemRepo.find({ where: { catalogVersionId: version.catalogVersionId }, order: { itemId: 'ASC' } }),
      this.recipeRepo.find({
        where: { catalogVersionId: version.catalogVersionId },
        order: { parentItemId: 'ASC', componentOrder: 'ASC', componentItemId: 'ASC' },
      }),
    ]);
    const catalog = buildRecommendationRulesetCatalogV1({
      version: {
        catalogVersionId: version.catalogVersionId,
        contentCatalogVersionId: version.contentCatalogVersionId,
        clientVersion: version.clientVersion,
        rulesetKey: version.rulesetKey,
        source: version.source,
        payloadSha256: version.payloadSha256,
        importedAt: version.importedAt.toISOString(),
      },
      items: itemRows.map((row) => {
        const semantics = resolveRecommendationCatalogAssetSemantics(row);
        return {
          itemId: Number(row.itemId),
          name: row.name,
          className: row.className,
          itemType: semantics.itemType,
          slotType: row.slotType,
          cost: row.cost,
          tier: row.tier,
          shopable: semantics.shopable,
          disabled: semantics.disabled,
          active: semantics.active,
          isActiveItem: semantics.isActiveItem,
          activationType: semantics.activationType,
          rawPayload: row.rawPayload,
        };
      }),
      recipeEdges: recipeRows.map((row) => ({
        parentItemId: Number(row.parentItemId),
        componentItemId: Number(row.componentItemId),
        componentOrder: row.componentOrder,
      })),
    });
    const compiled = compileStrictRecommendationCatalogV1(catalog);

    const ownedItemIds = local.items.map((item) => item.id).sort((a, b) => a - b);
    const heldByItemId = buildInventoryInstancesForRecommendation(ownedItemIds, compiled.graph);
    const inventory: InventoryState = {
      initializedFromSnapshot: true,
      heldByItemId,
      lifecycleCountByItemId: new Map(ownedItemIds.map((itemId) => [itemId, 1])),
      nextInstanceSequence: heldByItemId.size + 1,
    };

    const canVerifySpendable = await this.soulsEvidence.canVerifyScope(
      compiled.rulesetId,
      version.payloadSha256,
    );
    const spendableSouls = canVerifySpendable && Number.isFinite(local.souls)
      ? observedFact(local.souls as number, `souls-affordability:${compiled.rulesetId}:${version.payloadSha256}`)
      : unknownFact<number>('souls-affordability-scope-unverified');

    const teamTotals = calculateTeamSoulTotals(match, local.teamId);
    const enemyHeroIds = Object.values(match.playersBySteamId)
      .filter((player) => player.teamId !== undefined && player.teamId !== local.teamId)
      .map((player) => player.heroId)
      .filter((heroId): heroId is number => Number.isInteger(heroId))
      .sort((a, b) => a - b);
    const gameTimeSec = Number.isFinite(match.gameTimeSec) ? (match.gameTimeSec as number) : 0;
    const stateRevision = computeStateRevision(match, localSteamId, version, ownedItemIds);
    const state: RecommendationDecisionState = {
      decisionId: `adaptive:${stateRevision.slice(0, 24)}`,
      matchId,
      playerSlot: stablePlayerSlot(match, localSteamId),
      gameTimeSec,
      rulesetId: compiled.rulesetId,
      heroId: local.heroId,
      inventory,
      economy: {
        spendableSouls,
        shopOpportunity: unknownFact('direct-shop-opportunity-unobserved'),
      },
    };

    return {
      state,
      itemGraph: compiled.graph,
      catalogVersionId: version.catalogVersionId,
      catalogSha256: version.payloadSha256,
      rulesetId: compiled.rulesetId,
      localSteamId,
      enemyHeroIds,
      ourTeamSouls: teamTotals.our,
      enemyTeamSouls: teamTotals.enemy,
      stateRevision,
    };
  }
}

function resolveLocalSteamId(match: MinimalMatchState, requested?: string): string {
  if (requested && match.playersBySteamId[requested]) return requested;

  const markedLocal = Object.values(match.playersBySteamId)
    .filter((player) => player.isLocal)
    .sort((a, b) => a.steamId.localeCompare(b.steamId));
  if (markedLocal.length === 1) return markedLocal[0].steamId;
  if (markedLocal.length > 1) {
    throw new AdaptiveLiveStateNotReadyError(match.matchId, 'LOCAL_PLAYER_UNRESOLVED');
  }

  const realPlayers = Object.values(match.playersBySteamId)
    .filter((player) => player.steamId !== '0' && !player.steamId.startsWith('bot:'))
    .sort((a, b) => a.steamId.localeCompare(b.steamId));
  if (realPlayers.length === 1) return realPlayers[0].steamId;

  throw new AdaptiveLiveStateNotReadyError(match.matchId, 'LOCAL_PLAYER_UNRESOLVED');
}

function calculateTeamSoulTotals(
  match: MinimalMatchState,
  localTeamId: number,
): { our?: number; enemy?: number } {
  const ourPlayers = Object.values(match.playersBySteamId).filter((player) => player.teamId === localTeamId);
  const enemyPlayers = Object.values(match.playersBySteamId).filter(
    (player) => player.teamId !== undefined && player.teamId !== localTeamId,
  );
  return {
    our: finiteSoulTotal(ourPlayers),
    enemy: finiteSoulTotal(enemyPlayers),
  };
}

function finiteSoulTotal(players: readonly MinimalPlayerState[]): number | undefined {
  if (players.length === 0 || players.some((player) => !Number.isFinite(player.souls))) return undefined;
  return players.reduce((sum, player) => sum + (player.souls as number), 0);
}

function stablePlayerSlot(match: MinimalMatchState, localSteamId: string): number {
  return Object.keys(match.playersBySteamId).sort().indexOf(localSteamId);
}

function computeStateRevision(
  match: MinimalMatchState,
  localSteamId: string,
  version: RecommendationItemCatalogVersionV1,
  ownedItemIds: readonly number[],
): string {
  const roster = Object.values(match.playersBySteamId)
    .map((player) => ({
      steamId: player.steamId,
      heroId: player.heroId,
      teamId: player.teamId,
      souls: player.souls,
      itemIds: player.items.map((item) => item.id).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.steamId.localeCompare(b.steamId));
  const payload = {
    matchId: match.matchId,
    localSteamId,
    gameTimeSec: match.gameTimeSec,
    rulesetId: version.rulesetKey,
    catalogSha256: version.payloadSha256,
    ownedItemIds,
    roster,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
