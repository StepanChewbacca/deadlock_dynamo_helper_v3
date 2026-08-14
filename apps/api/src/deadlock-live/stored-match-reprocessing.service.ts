import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { isAbilityItem, mapAbilityToSkillNumber } from './hero-abilities';
import { Item } from './entities/item.entity';
import { MatchPlayerItem } from './entities/match-player-item.entity';
import { MatchPlayerSkillUpgrade } from './entities/match-player-skill-upgrade.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { Match } from './entities/match.entity';
import { RawMatchMetadata } from './entities/raw-match-metadata.entity';
import { RawMatchMetadataService } from './raw-match-metadata.service';

export const MATCH_METADATA_PROCESSING_VERSION =
  'match-metadata-v4-direct-account-identity';

interface ParsedBuildItem {
  itemId: number;
  purchaseTimeS: number;
  soldTimeS: number;
  upgradeId: number;
  flags: number;
  imbuedAbilityId: number;
  upgradeInfo: number;
}

interface ParsedSkillItem {
  abilityId: number;
  gameTimeSec: number;
}

interface ParsedPlayerItems {
  buildItems: ParsedBuildItem[];
  skillItems: ParsedSkillItem[];
  unknownItemEventsSkipped: number;
}

interface KnownItemCatalog {
  itemIds: Set<number>;
  source: 'ITEMS_REFERENCE';
}

export interface StoredMatchReprocessingResult {
  matchId: number;
  rawMetadataId: number;
  playersProcessed: number;
  playerAccountIdsPersisted: number;
  itemEventsProcessed: number;
  skillEventsProcessed: number;
  unknownItemEventsSkipped: number;
  itemCatalogSource: KnownItemCatalog['source'];
  processingVersion: string;
}

export function shouldPruneMissingMatchPlayers(
  existingPlayerCount: number,
  processedPlayerCount: number,
): boolean {
  return processedPlayerCount >= existingPlayerCount;
}

@Injectable()
export class StoredMatchReprocessingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rawMatchMetadataService: RawMatchMetadataService,
  ) {}

  async reprocess(matchId: number): Promise<StoredMatchReprocessingResult> {
    const rawMetadata = await this.rawMatchMetadataService.getBestForReprocessing(matchId);
    return this.reprocessRawMetadata(rawMetadata);
  }

  async reprocessRawMetadata(
    rawMetadata: RawMatchMetadata,
  ): Promise<StoredMatchReprocessingResult> {
    const matchId = Number(rawMetadata.matchId);

    return this.dataSource.transaction(async (manager) => {
      const result = await this.processPayload(manager, matchId, rawMetadata);
      const lastProcessedAt = new Date();
      await manager.getRepository(RawMatchMetadata).update(rawMetadata.id, {
        processingVersion: MATCH_METADATA_PROCESSING_VERSION,
        lastProcessedAt,
      });
      Object.assign(rawMetadata, {
        processingVersion: MATCH_METADATA_PROCESSING_VERSION,
        lastProcessedAt,
      });

      return {
        matchId,
        rawMetadataId: rawMetadata.id,
        ...result,
        processingVersion: MATCH_METADATA_PROCESSING_VERSION,
      };
    });
  }

  private async processPayload(
    manager: EntityManager,
    matchId: number,
    rawMetadata: RawMatchMetadata,
  ): Promise<
    Omit<StoredMatchReprocessingResult, 'matchId' | 'rawMetadataId' | 'processingVersion'>
  > {
    const matchInfo = toRecord(rawMetadata.payload.match_info);
    if (!matchInfo) {
      throw new Error(`Raw metadata for match ${matchId} does not contain match_info`);
    }

    const players = toRecordArray(matchInfo.players);
    if (players.length === 0) {
      throw new Error(`Raw metadata for match ${matchId} does not contain players`);
    }

    const knownItems = await this.loadKnownItems(manager);
    const matchRepository = manager.getRepository(Match);
    const matchPlayerRepository = manager.getRepository(MatchPlayer);
    const matchPlayerItemRepository = manager.getRepository(MatchPlayerItem);
    const matchPlayerSkillRepository = manager.getRepository(MatchPlayerSkillUpgrade);

    const winningTeam = getNumericValue(matchInfo, 'winning_team') ?? 0;
    const startTimeSeconds = getNumericValue(matchInfo, 'start_time') ?? 0;
    const durationS = getNumericValue(matchInfo, 'duration_s') ?? 0;
    const averageBadge = Math.max(
      getNumericValue(matchInfo, 'average_badge_team0') ?? 0,
      getNumericValue(matchInfo, 'average_badge_team1') ?? 0,
    );

    let match = await matchRepository.findOne({ where: { matchId } });
    if (!match) {
      match = matchRepository.create({ matchId });
    }
    match.startTime = new Date(startTimeSeconds * 1000);
    match.durationS = durationS;
    match.averageBadge = averageBadge;
    match.winningTeam = winningTeam;
    await matchRepository.save(match);

    const existingPlayersBeforeProcessing = await matchPlayerRepository.find({
      where: { matchId },
    });
    let playersProcessed = 0;
    let playerAccountIdsPersisted = 0;
    let itemEventsProcessed = 0;
    let skillEventsProcessed = 0;
    let unknownItemEventsSkipped = 0;
    const processedHeroIds = new Set<number>();

    for (const playerPayload of players) {
      const heroId = getNumericValue(playerPayload, 'hero_id');
      if (heroId === undefined || heroId <= 0 || processedHeroIds.has(heroId)) {
        continue;
      }
      processedHeroIds.add(heroId);

      const team = getNumericValue(playerPayload, 'team') ?? 0;
      const accountId = getPositiveSafeIntegerValue(playerPayload, 'account_id');
      const parsedItems = this.parseItems(playerPayload, heroId, knownItems.itemIds);

      let player = await matchPlayerRepository.findOne({
        where: { matchId, heroId },
      });
      if (!player) {
        player = matchPlayerRepository.create({ matchId, heroId });
      }

      if (accountId !== undefined) {
        player.accountId = accountId;
        playerAccountIdsPersisted += 1;
      }
      player.team = team;
      player.won = team === winningTeam;
      player.kills = getNumericValue(playerPayload, 'kills') ?? 0;
      player.deaths = getNumericValue(playerPayload, 'deaths') ?? 0;
      player.assists = getNumericValue(playerPayload, 'assists') ?? 0;
      player.netWorth = getNumericValue(playerPayload, 'net_worth') ?? 0;
      player = await matchPlayerRepository.save(player);

      await matchPlayerItemRepository.delete({ matchPlayerId: player.id });
      await matchPlayerSkillRepository.delete({ matchPlayerId: player.id });

      if (parsedItems.buildItems.length > 0) {
        await matchPlayerItemRepository.save(
          parsedItems.buildItems.map((item, index) =>
            matchPlayerItemRepository.create({
              matchPlayerId: player.id,
              itemId: item.itemId,
              purchaseTimeS: item.purchaseTimeS,
              soldTimeS: item.soldTimeS,
              upgradeId: item.upgradeId,
              flags: item.flags,
              imbuedAbilityId: item.imbuedAbilityId,
              upgradeInfo: item.upgradeInfo,
              slotOrder: index,
            }),
          ),
        );
      }

      const orderedSkills = parsedItems.skillItems
        .sort((left, right) => left.gameTimeSec - right.gameTimeSec)
        .slice(0, 16);
      if (orderedSkills.length > 0) {
        await matchPlayerSkillRepository.save(
          orderedSkills.map((skill, index) =>
            matchPlayerSkillRepository.create({
              matchPlayerId: player.id,
              abilityId: mapAbilityToSkillNumber(heroId, skill.abilityId),
              upgradeOrder: index,
              upgradeTimeS: skill.gameTimeSec,
            }),
          ),
        );
      }

      playersProcessed += 1;
      itemEventsProcessed += parsedItems.buildItems.length;
      skillEventsProcessed += orderedSkills.length;
      unknownItemEventsSkipped += parsedItems.unknownItemEventsSkipped;
    }

    if (
      shouldPruneMissingMatchPlayers(
        existingPlayersBeforeProcessing.length,
        processedHeroIds.size,
      )
    ) {
      const existingPlayers = await matchPlayerRepository.find({ where: { matchId } });
      for (const existingPlayer of existingPlayers) {
        if (!processedHeroIds.has(Number(existingPlayer.heroId))) {
          await matchPlayerRepository.delete({ id: existingPlayer.id });
        }
      }
    }

    return {
      playersProcessed,
      playerAccountIdsPersisted,
      itemEventsProcessed,
      skillEventsProcessed,
      unknownItemEventsSkipped,
      itemCatalogSource: knownItems.source,
    };
  }

  private async loadKnownItems(manager: EntityManager): Promise<KnownItemCatalog> {
    const itemRows = await manager.getRepository(Item).find();
    return {
      itemIds: new Set(itemRows.map((item) => Number(item.itemId))),
      source: 'ITEMS_REFERENCE',
    };
  }

  private parseItems(
    playerPayload: Record<string, unknown>,
    heroId: number,
    knownItemIds: ReadonlySet<number>,
  ): ParsedPlayerItems {
    const buildItems: ParsedBuildItem[] = [];
    const skillItems: ParsedSkillItem[] = [];
    let unknownItemEventsSkipped = 0;

    for (const item of toRecordArray(playerPayload.items)) {
      const itemId = getNumericValue(item, 'item_id');
      if (itemId === undefined || itemId <= 0) {
        continue;
      }

      const gameTimeSec = getNumericValue(item, 'game_time_s') ?? 0;
      if (isAbilityItem(heroId, itemId)) {
        skillItems.push({ abilityId: itemId, gameTimeSec });
        continue;
      }

      if (!knownItemIds.has(itemId)) {
        unknownItemEventsSkipped += 1;
        continue;
      }

      buildItems.push({
        itemId,
        purchaseTimeS: gameTimeSec,
        soldTimeS: getNumericValue(item, 'sold_time_s') ?? 0,
        upgradeId: getNumericValue(item, 'upgrade_id') ?? 0,
        flags: getNumericValue(item, 'flags') ?? 0,
        imbuedAbilityId: getNumericValue(item, 'imbued_ability_id') ?? 0,
        upgradeInfo: getNumericValue(item, 'upgrade_info') ?? 0,
      });
    }

    return { buildItems, skillItems, unknownItemEventsSkipped };
  }
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
    : [];
}

function getNumericValue(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getPositiveSafeIntegerValue(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = getNumericValue(record, key);
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}
