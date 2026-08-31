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
import { ItemCatalogVersion } from '../deadlock-live/entities/item-catalog-version.entity';
import { ItemCatalogItem } from '../deadlock-live/entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from '../deadlock-live/entities/item-catalog-recipe.entity';

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

@Injectable()
export class AdaptiveDecisionStateV1Service {
  constructor(
    private readonly liveState: LiveMatchStateService,
    private readonly soulsEvidence: SoulsAffordabilityEvidenceV2Service,
    @InjectRepository(ItemCatalogVersion)
    private readonly versionRepo: Repository<ItemCatalogVersion>,
    @InjectRepository(ItemCatalogItem)
    private readonly itemRepo: Repository<ItemCatalogItem>,
    @InjectRepository(ItemCatalogRecipe)
    private readonly recipeRepo: Repository<ItemCatalogRecipe>,
  ) {}

  async build(matchId: string, requestedLocalSteamId?: string): Promise<AdaptiveDecisionStateV1> {
    const match = this.liveState.getState(matchId);
    if (!match) throw new Error(`Live match state unavailable: ${matchId}`);
    const localSteamId = resolveLocalSteamId(match, requestedLocalSteamId);
    const local = match.playersBySteamId[localSteamId];
    if (!local?.heroId || local.teamId === undefined) {
      throw new Error(`Local player identity incomplete: ${localSteamId}`);
    }

    const version = await this.versionRepo.findOne({
      order: { importedAt: 'DESC', catalogVersionId: 'DESC' },
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
      items: itemRows.map((row) => ({
        itemId: Number(row.itemId),
        name: row.name,
        className: row.className,
        itemType: row.itemType,
        slotType: row.slotType,
        cost: row.cost,
        tier: row.tier,
        shopable: row.shopable,
        disabled: row.disabled,
        active: row.active,
        isActiveItem: row.isActiveItem,
        activationType: row.activationType,
        rawPayload: row.rawPayload,
      })),
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
  const local = Object.values(match.playersBySteamId)
    .filter((player) => player.isLocal)
    .sort((a, b) => a.steamId.localeCompare(b.steamId));
  if (local.length !== 1) throw new Error(`Unable to resolve exactly one local player for match ${match.matchId}`);
  return local[0].steamId;
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
  version: ItemCatalogVersion,
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
