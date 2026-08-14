import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { CrawlerRun } from './entities/crawler-run.entity';
import { CrawlerState } from './entities/crawler-state.entity';
import { Item } from './entities/item.entity';
import { Match } from './entities/match.entity';
import { MatchPlayerItem } from './entities/match-player-item.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { MatchPlayerSkillUpgrade } from './entities/match-player-skill-upgrade.entity';
import { RawMatchMetadata } from './entities/raw-match-metadata.entity';
import { getDeadlockApiRequestConfig } from './deadlock-api-request';
import { isAbilityItem, mapAbilityToSkillNumber } from './hero-abilities';
import {
  chunkValues,
  getRecentMatchCutoff,
  RECENT_MATCH_TARGET_COUNT,
  RECENT_MATCH_WINDOW_DAYS,
  RecentMatchesWindowService,
} from './recent-matches-window.service';

const API_BASE_URL = 'https://api.deadlock-api.com';
const MATCH_LIST_DELAY_WITH_KEY_MS = 6_500;
const MATCH_LIST_DELAY_WITHOUT_KEY_MS = 6_500;
const MATCH_DETAILS_DELAY_WITH_KEY_MS = 11_000;
const MATCH_DETAILS_DELAY_WITHOUT_KEY_MS = 1_250_000;
const MATCH_LIST_RATE_LIMIT_WAIT_MS = 12_000;
const MATCH_DETAILS_RATE_LIMIT_WAIT_MS = 20_000;
const RATE_LIMIT_MAX_WAIT_MS = 3 * 60_000;
const RETENTION_DELETE_BATCH_SIZE = 500;

export const RECENT_MATCH_CRAWL_CRON = '0 0 */4 * * *';
export const STANDARD_MATCH_PLAYER_COUNT = 12;
export const STANDARD_MATCH_TEAM_SIZE = 6;

export interface RecentMatchCrawlProgress {
  isCrawling: boolean;
  current: number;
  total: number;
  currentHero: string;
  status: string;
}

interface ItemReference {
  name: string;
  cost: number;
  slotType: string;
}

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
  gameTimeS: number;
}

interface CrawlBatchResult {
  discoveredMatches: number;
  processedMatches: number;
  acceptedMatches: number;
}

interface ProcessedMatchBatchResult {
  processedMatches: number;
  acceptedMatches: number;
}

export function calculateMissingRecentMatchCount(currentMatchCount: number): number {
  return Math.max(0, RECENT_MATCH_TARGET_COUNT - currentMatchCount);
}

export function isStandardSixVsSixRoster(players: readonly unknown[]): boolean {
  if (players.length !== STANDARD_MATCH_PLAYER_COUNT) {
    return false;
  }

  const heroIds = new Set<number>();
  let teamZeroCount = 0;
  let teamOneCount = 0;

  for (const value of players) {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const player = value as Record<string, unknown>;
    const heroId = toPositiveSafeInteger(player.hero_id);
    if (heroId === undefined || heroIds.has(heroId)) {
      return false;
    }
    heroIds.add(heroId);

    const team = Number(player.team);
    if (team === 0) {
      teamZeroCount += 1;
    } else if (team === 1) {
      teamOneCount += 1;
    } else {
      return false;
    }
  }

  return (
    teamZeroCount === STANDARD_MATCH_TEAM_SIZE &&
    teamOneCount === STANDARD_MATCH_TEAM_SIZE
  );
}

@Injectable()
export class RecentMatchCrawlerService implements OnModuleInit {
  private readonly logger = new Logger(RecentMatchCrawlerService.name);
  private readonly crawlerType = 'all_heroes';
  private readonly itemsById = new Map<number, ItemReference>();
  private readonly hasApiKey = Boolean(process.env.DEADLOCK_API_KEY?.trim());
  private readonly enabled =
    process.env.DEADLOCK_RECENT_MATCH_CRAWLER_ENABLED?.trim().toLowerCase() !==
    'false';

  private isCrawling = false;
  private activeRunId?: number;
  private progress: RecentMatchCrawlProgress = {
    isCrawling: false,
    current: 0,
    total: 0,
    currentHero: '',
    status: 'Idle',
  };

  constructor(
    @InjectRepository(Match)
    private readonly matchRepository: Repository<Match>,
    @InjectRepository(MatchPlayer)
    private readonly matchPlayerRepository: Repository<MatchPlayer>,
    @InjectRepository(MatchPlayerItem)
    private readonly matchPlayerItemRepository: Repository<MatchPlayerItem>,
    @InjectRepository(MatchPlayerSkillUpgrade)
    private readonly matchPlayerSkillUpgradeRepository: Repository<MatchPlayerSkillUpgrade>,
    @InjectRepository(Item)
    private readonly itemRepository: Repository<Item>,
    @InjectRepository(RawMatchMetadata)
    private readonly rawMatchMetadataRepository: Repository<RawMatchMetadata>,
    @InjectRepository(CrawlerState)
    private readonly crawlerStateRepository: Repository<CrawlerState>,
    @InjectRepository(CrawlerRun)
    private readonly crawlerRunRepository: Repository<CrawlerRun>,
    private readonly recentMatchesWindowService: RecentMatchesWindowService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Recent match crawler is disabled for this runtime.');
      return;
    }
    await this.recoverCrawlerStateAfterRestart();
    const removedMatchCount = await this.pruneInvalidMatches();
    if (removedMatchCount > 0) {
      this.logger.log(
        `Removed ${removedMatchCount} invalid, non-standard, expired, or overflow matches during startup.`,
      );
    }
  }

  getProgress(): RecentMatchCrawlProgress {
    return { ...this.progress };
  }

  async startCrawling(): Promise<void> {
    if (!this.enabled || this.isCrawling) {
      return;
    }

    this.isCrawling = true;
    this.progress = {
      isCrawling: true,
      current: 0,
      total: 0,
      currentHero: '',
      status: 'Starting two-week match crawl...',
    };
    this.activeRunId = await this.createCrawlerRun();
    await this.syncCrawlerState();

    void this.runCrawl().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Crawl failed: ${message}`);
      this.progress.status = `Failed: ${message}`;
      this.isCrawling = false;
      this.progress.isCrawling = false;
      void this.finalizeCrawlerRun('failed', message);
      void this.syncCrawlerState();
    });
  }

  @Cron(RECENT_MATCH_CRAWL_CRON, {
    name: 'recent-match-crawl-six-times-daily',
    timeZone: 'UTC',
  })
  async scheduledCrawl(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    this.logger.log('Starting scheduled four-hour crawl for the two-week match window.');
    await this.startCrawling();
  }

  private getMatchListDelayMs(): number {
    return this.hasApiKey
      ? MATCH_LIST_DELAY_WITH_KEY_MS
      : MATCH_LIST_DELAY_WITHOUT_KEY_MS;
  }

  private getMatchDetailsDelayMs(): number {
    return this.hasApiKey
      ? MATCH_DETAILS_DELAY_WITH_KEY_MS
      : MATCH_DETAILS_DELAY_WITHOUT_KEY_MS;
  }

  private getRateLimitWaitMs(scope: 'list' | 'details', attempt: number): number {
    const baseWaitMs =
      scope === 'list' ? MATCH_LIST_RATE_LIMIT_WAIT_MS : MATCH_DETAILS_RATE_LIMIT_WAIT_MS;
    return Math.min(
      RATE_LIMIT_MAX_WAIT_MS,
      baseWaitMs * 2 ** Math.max(0, attempt - 1),
    );
  }

  private async waitForRateLimit(
    scope: 'list' | 'details',
    attempt: number,
    error?: unknown,
    matchId?: number,
  ): Promise<void> {
    const waitMs =
      getRetryAfterWaitMs(error) ?? this.getRateLimitWaitMs(scope, attempt);
    const scopeLabel = scope === 'list' ? 'match list' : `match ${matchId ?? 'details'}`;
    this.progress.status = `Rate limited on ${scopeLabel}, waiting ${Math.round(waitMs / 1000)} seconds...`;
    await this.syncCrawlerState(matchId);
    await this.sleep(waitMs);
  }

  private async runCrawl(): Promise<void> {
    try {
      this.progress.status = `Applying ${RECENT_MATCH_WINDOW_DAYS}-day retention...`;
      await this.syncCrawlerState();
      const removedBeforeCrawl = await this.pruneInvalidMatches();

      const cutoff = getRecentMatchCutoff(new Date());
      const existingMatches = await this.matchRepository.find({
        where: { startTime: MoreThanOrEqual(cutoff) },
        order: { startTime: 'DESC', matchId: 'DESC' },
        take: RECENT_MATCH_TARGET_COUNT,
        select: { matchId: true },
      });
      const processedMatchIds = new Set(
        existingMatches.map((match) => Number(match.matchId)),
      );
      const missingMatchCount = calculateMissingRecentMatchCount(processedMatchIds.size);

      this.logger.log(
        `Retained ${processedMatchIds.size}/${RECENT_MATCH_TARGET_COUNT} standard 6v6 matches from the last ` +
          `${RECENT_MATCH_WINDOW_DAYS} days and removed ${removedBeforeCrawl} invalid matches.`,
      );

      this.progress.status =
        missingMatchCount > 0
          ? `Discovering up to ${missingMatchCount} new standard 6v6 matches...`
          : 'The recent standard 6v6 match window is already full.';
      await this.syncCrawlerState();

      this.progress.total = missingMatchCount;
      await this.updateCrawlerRun({
        targetMatches: missingMatchCount,
        discoveredMatches: 0,
        processedMatches: 0,
      });
      await this.syncCrawlerState();

      const crawlBatchResult =
        missingMatchCount > 0
          ? await this.crawlCandidateMatches(
              processedMatchIds,
              missingMatchCount,
              cutoff,
            )
          : { discoveredMatches: 0, processedMatches: 0, acceptedMatches: 0 };

      this.progress.status = 'Applying final two-week retention...';
      await this.syncCrawlerState();
      const removedAfterCrawl = await this.pruneInvalidMatches();
      await this.recentMatchesWindowService.refresh();

      const finalMatchCount = this.recentMatchesWindowService.getStatus().matchCount;
      const windowIsFull = finalMatchCount >= RECENT_MATCH_TARGET_COUNT;
      this.progress.status = windowIsFull
        ? `Crawl finished successfully: ${finalMatchCount}/${RECENT_MATCH_TARGET_COUNT} ` +
          `standard 6v6 matches retained for the last ${RECENT_MATCH_WINDOW_DAYS} days.`
        : `Crawl finished with partial window: ${finalMatchCount}/${RECENT_MATCH_TARGET_COUNT} ` +
          `standard 6v6 matches retained for the last ${RECENT_MATCH_WINDOW_DAYS} days. ` +
          `The source returned ${crawlBatchResult.discoveredMatches} candidates and ` +
          `${crawlBatchResult.acceptedMatches} were accepted as standard 6v6.`;
      this.logger.log(
        `${this.progress.status} Removed ${removedAfterCrawl} matches after processing.`,
      );
      await this.finalizeCrawlerRun(
        'completed',
        windowIsFull ? undefined : this.progress.status,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Crawl aborted: ${message}`);
      this.progress.status = `Crawl aborted: ${message}`;
      await this.finalizeCrawlerRun('failed', message);
    } finally {
      this.isCrawling = false;
      this.progress.isCrawling = false;
      await this.syncCrawlerState();
    }
  }

  private async crawlCandidateMatches(
    processedMatchIds: ReadonlySet<number>,
    targetCount: number,
    cutoff: Date,
  ): Promise<CrawlBatchResult> {
    const seenMatchIds = new Set<number>();
    let maxMatchId: number | undefined;
    let rateLimitAttempts = 0;
    let discoveredMatches = 0;
    let processedMatches = 0;
    let acceptedMatches = 0;

    while (acceptedMatches < targetCount) {
      try {
        const response = await axios.get(`${API_BASE_URL}/v1/matches/metadata`, {
          ...getDeadlockApiRequestConfig(),
          params: {
            order_by: 'match_id',
            order_direction: 'desc',
            limit: Math.min(1_000, targetCount - acceptedMatches),
            ...(maxMatchId !== undefined ? { max_match_id: maxMatchId } : {}),
          },
        });
        const matches = Array.isArray(response.data) ? response.data : [];
        if (matches.length === 0) {
          break;
        }

        let oldestMatchId: number | undefined;
        let pageHasRecentMatches = false;
        const pageMatchIds: number[] = [];
        for (const candidate of matches) {
          const matchId = toPositiveSafeInteger(candidate?.match_id);
          if (matchId === undefined) {
            continue;
          }

          const candidateStartTime = parseMatchListStartTime(candidate?.start_time);
          if (candidateStartTime && candidateStartTime >= cutoff) {
            pageHasRecentMatches = true;
          }

          oldestMatchId =
            oldestMatchId === undefined ? matchId : Math.min(oldestMatchId, matchId);

          if (candidateStartTime && candidateStartTime < cutoff) {
            continue;
          }

          if (processedMatchIds.has(matchId) || seenMatchIds.has(matchId)) {
            continue;
          }

          seenMatchIds.add(matchId);
          pageMatchIds.push(matchId);
          discoveredMatches += 1;
        }

        if (oldestMatchId === undefined) {
          break;
        }

        const nextMaxMatchId = oldestMatchId - 1;
        if (maxMatchId !== undefined && nextMaxMatchId >= maxMatchId) {
          this.logger.warn(
            `Match pagination did not advance at max_match_id=${maxMatchId}.`,
          );
          break;
        }

        maxMatchId = nextMaxMatchId;
        rateLimitAttempts = 0;
        await this.updateCrawlerRun({
          discoveredMatches,
          processedMatches,
          currentMatchId: null,
          statusMessage:
            processedMatches > 0
              ? `Processed ${processedMatches} candidates; accepted ` +
                `${acceptedMatches}/${targetCount} standard 6v6 matches.`
              : `Discovering standard 6v6 matches ${acceptedMatches}/${targetCount}...`,
        });
        if (pageMatchIds.length > 0) {
          const processed = await this.processDiscoveredMatchIds(
            pageMatchIds,
            processedMatches,
            acceptedMatches,
            targetCount,
            cutoff,
          );
          processedMatches = processed.processedMatches;
          acceptedMatches = processed.acceptedMatches;
        }
        if (!pageHasRecentMatches) {
          break;
        }
        await this.sleep(this.getMatchListDelayMs());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to fetch match list before ${maxMatchId ?? 'latest'}: ${message}`,
        );
        if (getHttpStatus(error) === 429) {
          rateLimitAttempts += 1;
          await this.waitForRateLimit('list', rateLimitAttempts, error);
          continue;
        }
        break;
      }
    }

    return {
      discoveredMatches,
      processedMatches,
      acceptedMatches,
    };
  }

  private async processDiscoveredMatchIds(
    matchIds: readonly number[],
    processedMatches: number,
    acceptedMatches: number,
    targetCount: number,
    cutoff: Date,
  ): Promise<ProcessedMatchBatchResult> {
    let nextProcessedMatches = processedMatches;
    let nextAcceptedMatches = acceptedMatches;

    for (const matchId of matchIds) {
      if (nextAcceptedMatches >= targetCount) {
        break;
      }

      nextProcessedMatches += 1;
      this.progress.current = nextAcceptedMatches;
      this.progress.status =
        `Processing candidate ${nextProcessedMatches}: ${matchId}. ` +
        `Accepted ${nextAcceptedMatches}/${targetCount} standard 6v6 matches.`;
      await this.updateCrawlerRun({
        processedMatches: nextProcessedMatches,
        currentMatchId: matchId,
        statusMessage: this.progress.status,
      });
      await this.syncCrawlerState(matchId);

      try {
        const accepted = await this.processMatchWithRetry(matchId, cutoff);
        if (accepted) {
          nextAcceptedMatches += 1;
          this.progress.current = nextAcceptedMatches;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to process match ${matchId}: ${message}`);
      }

      await this.sleep(this.getMatchDetailsDelayMs());
    }

    return {
      processedMatches: nextProcessedMatches,
      acceptedMatches: nextAcceptedMatches,
    };
  }

  private async processMatchWithRetry(matchId: number, cutoff: Date): Promise<boolean> {
    let attempt = 0;

    while (true) {
      try {
        return await this.processMatch(matchId, cutoff);
      } catch (error) {
        if (getHttpStatus(error) !== 429) {
          throw error;
        }

        attempt += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Rate limited while fetching match ${matchId}: ${message}`);
        await this.waitForRateLimit('details', attempt, error, matchId);
      }
    }
  }

  private async processMatch(matchId: number, cutoff: Date): Promise<boolean> {
    const response = await axios.get(
      `${API_BASE_URL}/v1/matches/${matchId}/metadata`,
      getDeadlockApiRequestConfig(),
    );
    const matchInfo = response.data?.match_info;
    if (!matchInfo || !Array.isArray(matchInfo.players) || matchInfo.players.length === 0) {
      return false;
    }

    if (!isStandardSixVsSixRoster(matchInfo.players)) {
      this.logger.debug(`Skipping non-standard match ${matchId}; only 6v6 is retained.`);
      return false;
    }

    const startTime = new Date(Number(matchInfo.start_time ?? 0) * 1_000);
    if (!Number.isFinite(startTime.getTime()) || startTime < cutoff) {
      this.logger.debug(`Skipping expired match ${matchId}.`);
      return false;
    }

    await this.ensureItemReferencesLoaded();

    const winningTeam = Number(matchInfo.winning_team ?? 0);
    const durationS = Number(matchInfo.duration_s ?? 0);
    const averageBadge = Math.max(
      Number(matchInfo.average_badge_team0 ?? 0),
      Number(matchInfo.average_badge_team1 ?? 0),
    );

    await this.matchRepository.manager.transaction(async (manager) => {
      const matchRepository = manager.getRepository(Match);
      const playerRepository = manager.getRepository(MatchPlayer);
      const itemRepository = manager.getRepository(MatchPlayerItem);
      const skillRepository = manager.getRepository(MatchPlayerSkillUpgrade);

      let match = await matchRepository.findOne({ where: { matchId } });
      if (!match) {
        match = matchRepository.create({ matchId });
      }
      match.startTime = startTime;
      match.durationS = durationS;
      match.averageBadge = averageBadge;
      match.winningTeam = winningTeam;
      await matchRepository.save(match);

      const processedHeroIds = new Set<number>();
      for (const playerPayload of matchInfo.players) {
        const heroId = toPositiveSafeInteger(playerPayload?.hero_id);
        if (heroId === undefined || processedHeroIds.has(heroId)) {
          continue;
        }
        processedHeroIds.add(heroId);

        const accountId = toPositiveSafeInteger(playerPayload?.account_id);
        const team = Number(playerPayload?.team ?? 0);
        const parsedItems = this.parsePlayerItems(playerPayload, heroId);

        let player = await playerRepository.findOne({ where: { matchId, heroId } });
        if (!player) {
          player = playerRepository.create({ matchId, heroId });
        }
        if (accountId !== undefined) {
          player.accountId = accountId;
        }
        player.team = team;
        player.won = team === winningTeam;
        player.kills = Number(playerPayload?.kills ?? 0);
        player.deaths = Number(playerPayload?.deaths ?? 0);
        player.assists = Number(playerPayload?.assists ?? 0);
        player.netWorth = Number(playerPayload?.net_worth ?? 0);
        player = await playerRepository.save(player);

        await itemRepository.delete({ matchPlayerId: player.id });
        await skillRepository.delete({ matchPlayerId: player.id });

        if (parsedItems.buildItems.length > 0) {
          await itemRepository.save(
            parsedItems.buildItems.map((item, slotOrder) =>
              itemRepository.create({
                matchPlayerId: player.id,
                itemId: item.itemId,
                purchaseTimeS: item.purchaseTimeS,
                soldTimeS: item.soldTimeS,
                upgradeId: item.upgradeId,
                flags: item.flags,
                imbuedAbilityId: item.imbuedAbilityId,
                upgradeInfo: item.upgradeInfo,
                slotOrder,
              }),
            ),
          );
        }

        const orderedSkills = parsedItems.skillItems
          .sort((left, right) => left.gameTimeS - right.gameTimeS)
          .slice(0, 16);
        if (orderedSkills.length > 0) {
          await skillRepository.save(
            orderedSkills.map((skill, upgradeOrder) =>
              skillRepository.create({
                matchPlayerId: player.id,
                abilityId: mapAbilityToSkillNumber(heroId, skill.abilityId),
                upgradeOrder,
                upgradeTimeS: skill.gameTimeS,
              }),
            ),
          );
        }
      }
    });

    return true;
  }

  private parsePlayerItems(
    playerPayload: Record<string, unknown>,
    heroId: number,
  ): { buildItems: ParsedBuildItem[]; skillItems: ParsedSkillItem[] } {
    const buildItems: ParsedBuildItem[] = [];
    const skillItems: ParsedSkillItem[] = [];
    const rawItems = Array.isArray(playerPayload.items) ? playerPayload.items : [];

    for (const rawItem of rawItems) {
      const itemId = toPositiveSafeInteger(rawItem?.item_id);
      if (itemId === undefined) {
        continue;
      }

      const gameTimeS = toNonNegativeInteger(rawItem?.game_time_s);
      if (isAbilityItem(heroId, itemId)) {
        skillItems.push({ abilityId: itemId, gameTimeS });
        continue;
      }

      if (!this.itemsById.has(itemId)) {
        continue;
      }

      buildItems.push({
        itemId,
        purchaseTimeS: gameTimeS,
        soldTimeS: toNonNegativeInteger(rawItem?.sold_time_s),
        upgradeId: toNonNegativeInteger(rawItem?.upgrade_id),
        flags: toNonNegativeInteger(rawItem?.flags),
        imbuedAbilityId: toNonNegativeInteger(rawItem?.imbued_ability_id),
        upgradeInfo: toNonNegativeInteger(rawItem?.upgrade_info),
      });
    }

    return { buildItems, skillItems };
  }

  private async ensureItemReferencesLoaded(): Promise<void> {
    if (this.itemsById.size > 0) {
      return;
    }

    const items = await this.itemRepository.find();
    for (const item of items) {
      this.itemsById.set(Number(item.itemId), {
        name: item.name,
        cost: Number(item.cost),
        slotType: item.itemSlotType,
      });
    }
  }

  private async pruneInvalidMatches(now = new Date()): Promise<number> {
    const cutoff = getRecentMatchCutoff(now);
    const [expiredMatches, nonStandardMatchRows] = await Promise.all([
      this.matchRepository.find({
        where: { startTime: LessThan(cutoff) },
        select: { matchId: true },
      }),
      this.matchRepository
        .createQueryBuilder('match')
        .leftJoin(MatchPlayer, 'player', 'player.matchId = match.matchId')
        .select('match.matchId', 'matchId')
        .groupBy('match.matchId')
        .having('COUNT(player.id) <> :playerCount', {
          playerCount: STANDARD_MATCH_PLAYER_COUNT,
        })
        .orHaving(
          'SUM(CASE WHEN player.team = 0 THEN 1 ELSE 0 END) <> :teamSize',
          { teamSize: STANDARD_MATCH_TEAM_SIZE },
        )
        .orHaving(
          'SUM(CASE WHEN player.team = 1 THEN 1 ELSE 0 END) <> :teamSize',
          { teamSize: STANDARD_MATCH_TEAM_SIZE },
        )
        .getRawMany<{ matchId: string | number }>(),
    ]);

    const initialMatchIds = [
      ...new Set([
        ...expiredMatches.map((match) => Number(match.matchId)),
        ...nonStandardMatchRows.map((row) => Number(row.matchId)),
      ]),
    ].filter((matchId) => Number.isSafeInteger(matchId) && matchId > 0);
    await this.deleteMatches(initialMatchIds);

    const validMatchCount = await this.matchRepository.count({
      where: { startTime: MoreThanOrEqual(cutoff) },
    });
    const overflowCount = Math.max(0, validMatchCount - RECENT_MATCH_TARGET_COUNT);
    const overflowMatches =
      overflowCount > 0
        ? await this.matchRepository.find({
            where: { startTime: MoreThanOrEqual(cutoff) },
            order: { startTime: 'ASC', matchId: 'ASC' },
            take: overflowCount,
            select: { matchId: true },
          })
        : [];
    const overflowMatchIds = overflowMatches.map((match) => Number(match.matchId));
    await this.deleteMatches(overflowMatchIds);

    const removedMatchIds = [...new Set([...initialMatchIds, ...overflowMatchIds])];
    if (removedMatchIds.length > 0) {
      this.logger.log(
        `Deleted ${removedMatchIds.length} expired, overflow, or non-standard matches. ` +
          `The database now keeps only standard 6v6 matches and at most the newest ` +
          `${RECENT_MATCH_TARGET_COUNT} from the last ${RECENT_MATCH_WINDOW_DAYS} days.`,
      );
    }

    return removedMatchIds.length;
  }

  private async deleteMatches(matchIds: readonly number[]): Promise<void> {
    for (const batch of chunkValues([...matchIds], RETENTION_DELETE_BATCH_SIZE)) {
      await this.matchRepository.manager.transaction(async (manager) => {
        await manager.getRepository(RawMatchMetadata).delete({ matchId: In(batch) });
        await manager.getRepository(Match).delete({ matchId: In(batch) });
      });
    }
  }

  private async syncCrawlerState(currentMatchId?: number): Promise<void> {
    let state = await this.crawlerStateRepository.findOne({
      where: { crawlerType: this.crawlerType },
    });
    if (!state) {
      state = this.crawlerStateRepository.create({ crawlerType: this.crawlerType });
    }

    state.isCrawling = this.progress.isCrawling;
    state.current = this.progress.current;
    state.total = this.progress.total;
    state.currentMatchId = currentMatchId ?? null;
    state.status = this.progress.status;
    state.lastError =
      state.status.startsWith('Failed') ||
      state.status.startsWith('Crawl aborted') ||
      state.status.startsWith('Crawl finished with partial window')
        ? state.status
        : null;
    if (!state.isCrawling && state.status.startsWith('Crawl finished successfully')) {
      state.lastSuccessAt = new Date();
    }

    await this.crawlerStateRepository.save(state);
  }

  private async createCrawlerRun(): Promise<number> {
    const run = this.crawlerRunRepository.create({
      crawlerType: this.crawlerType,
      status: 'running',
      targetMatches: 0,
      discoveredMatches: 0,
      processedMatches: 0,
      currentMatchId: null,
      statusMessage: this.progress.status,
      lastError: null,
      finishedAt: null,
    });
    const saved = await this.crawlerRunRepository.save(run);
    return saved.id;
  }

  private async updateCrawlerRun(partial: Partial<CrawlerRun>): Promise<void> {
    if (this.activeRunId === undefined) {
      return;
    }
    await this.crawlerRunRepository.update({ id: this.activeRunId }, partial);
  }

  private async finalizeCrawlerRun(
    status: 'completed' | 'failed',
    lastError?: string,
  ): Promise<void> {
    if (this.activeRunId === undefined) {
      return;
    }

    await this.crawlerRunRepository.update(
      { id: this.activeRunId },
      {
        status,
        processedMatches: this.progress.current,
        currentMatchId: null,
        statusMessage: this.progress.status,
        lastError: lastError ?? null,
        finishedAt: new Date(),
      },
    );
    this.activeRunId = undefined;
  }

  private async recoverCrawlerStateAfterRestart(): Promise<void> {
    await this.crawlerRunRepository
      .createQueryBuilder()
      .update(CrawlerRun)
      .set({
        status: 'failed',
        lastError: 'Process restarted while crawler was running',
        finishedAt: new Date(),
      })
      .where('crawlerType = :crawlerType', { crawlerType: this.crawlerType })
      .andWhere('status = :status', { status: 'running' })
      .execute();

    const state = await this.crawlerStateRepository.findOne({
      where: { crawlerType: this.crawlerType },
    });
    if (!state) {
      return;
    }

    state.isCrawling = false;
    state.currentMatchId = null;
    state.status = 'Idle';
    await this.crawlerStateRepository.save(state);
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

function toPositiveSafeInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function toNonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function getHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const response = (error as { response?: { status?: unknown } }).response;
  const status = Number(response?.status);
  return Number.isSafeInteger(status) ? status : undefined;
}

function getRetryAfterWaitMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const response = (
    error as {
      response?: {
        headers?: Record<string, unknown> & {
          get?: (name: string) => unknown;
        };
      };
    }
  ).response;
  const headers = response?.headers;
  const retryAfterValue = getHeaderValue(headers, 'retry-after');
  const limitValue = Number(getHeaderValue(headers, 'ratelimit-limit'));
  const periodValue = Number(getHeaderValue(headers, 'ratelimit-period'));
  const minimumRateWindowWaitMs =
    Number.isFinite(limitValue) &&
    limitValue > 0 &&
    Number.isFinite(periodValue) &&
    periodValue > 0
      ? Math.ceil((periodValue * 1_000) / limitValue)
      : undefined;
  if (typeof retryAfterValue !== 'string' && typeof retryAfterValue !== 'number') {
    const resetValue = getHeaderValue(headers, 'ratelimit-reset');
    const resetSeconds = Number(resetValue);
    if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
      return Math.max(
        1_000,
        minimumRateWindowWaitMs ?? 0,
        Math.ceil(resetSeconds * 1_000),
      );
    }
    return minimumRateWindowWaitMs;
  }

  const seconds = Number(retryAfterValue);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(
      1_000,
      minimumRateWindowWaitMs ?? 0,
      Math.ceil(seconds * 1_000),
    );
  }

  const dateMs = Date.parse(String(retryAfterValue));
  if (Number.isFinite(dateMs)) {
    return Math.max(1_000, minimumRateWindowWaitMs ?? 0, dateMs - Date.now());
  }

  return minimumRateWindowWaitMs;
}

function getHeaderValue(
  headers: (Record<string, unknown> & { get?: (name: string) => unknown }) | undefined,
  name: string,
): unknown {
  if (!headers) {
    return undefined;
  }

  const directValue = headers[name];
  if (directValue !== undefined) {
    return Array.isArray(directValue) ? directValue[0] : directValue;
  }

  if (typeof headers.get === 'function') {
    const getterValue = headers.get(name);
    return Array.isArray(getterValue) ? getterValue[0] : getterValue;
  }

  return undefined;
}

function parseMatchListStartTime(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  const parsed = new Date(`${value}Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}
