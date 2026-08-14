import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IsNull, Not, Repository } from 'typeorm';
import { MatchPlayer } from './entities/match-player.entity';

const DEFAULT_OBSERVABILITY_ROOT =
  '/app/apps/api/storage/recommendation-observability-v7';
const IDENTITY_FILE = 'player-identities.ndjson';
const MANIFEST_FILE = 'player-identities.manifest.json';

export interface RecommendationObservabilityV7PlayerIdentityRow {
  schemaVersion: 1;
  identityVersion: 'RECOMMENDATION_OBSERVABILITY_V7_DATASET_PLAYER_IDENTITY_1';
  matchId: string;
  datasetPlayerId: string;
  accountId: string;
  steamId: string;
  source: 'DIRECT_PERSISTED_IDENTITY';
  sourceField: 'match_players.accountId';
  identityDomain: 'STEAM_ACCOUNT_ID_U32';
}

@Injectable()
export class RecommendationObservabilityV7PlayerIdentityExportService
  implements OnModuleInit
{
  private readonly logger = new Logger(
    RecommendationObservabilityV7PlayerIdentityExportService.name,
  );
  private readonly outputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_OBSERVABILITY_V7_DIR?.trim() ||
    DEFAULT_OBSERVABILITY_ROOT;
  private readonly outputPath = join(this.outputDirectory, IDENTITY_FILE);
  private readonly manifestPath = join(this.outputDirectory, MANIFEST_FILE);
  private running = false;

  constructor(
    @InjectRepository(MatchPlayer)
    private readonly matchPlayerRepository: Repository<MatchPlayer>,
  ) {}

  onModuleInit(): void {
    void this.refresh().catch((error) => {
      this.logger.warn(`Initial V7 identity export failed: ${errorMessage(error)}`);
    });
  }

  @Cron('15 * * * * *', {
    name: 'recommendation-observability-v7-player-identity-export',
  })
  async scheduledRefresh(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      this.logger.warn(`V7 identity export failed: ${errorMessage(error)}`);
    }
  }

  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const players = await this.matchPlayerRepository.find({
        where: { accountId: Not(IsNull()) },
        select: { id: true, matchId: true, accountId: true },
        order: { matchId: 'ASC', id: 'ASC' },
      });
      const rows = players
        .map(buildRecommendationObservabilityV7PlayerIdentityRow)
        .filter(
          (row): row is RecommendationObservabilityV7PlayerIdentityRow =>
            row !== undefined,
        );

      await mkdir(this.outputDirectory, { recursive: true });
      const outputPartial = `${this.outputPath}.partial`;
      const manifestPartial = `${this.manifestPath}.partial`;
      await writeFile(
        outputPartial,
        rows.length > 0
          ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
          : '',
        'utf8',
      );
      await writeFile(
        manifestPartial,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            operation: 'RECOMMENDATION_OBSERVABILITY_V7_PLAYER_IDENTITY_EXPORT',
            identityVersion:
              'RECOMMENDATION_OBSERVABILITY_V7_DATASET_PLAYER_IDENTITY_1',
            generatedAt: new Date().toISOString(),
            rowCount: rows.length,
            sourceTable: 'match_players',
            sourceField: 'accountId',
            identityDomain: 'STEAM_ACCOUNT_ID_U32',
            liveEventsIdentityDomain: 'steam_id_u32',
            historicalIdentityInferencePerformed: false,
            heroIdentityInferencePerformed: false,
            teamIdentityInferencePerformed: false,
            playerPawnIdentityInferencePerformed: false,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      await rename(outputPartial, this.outputPath);
      await rename(manifestPartial, this.manifestPath);
    } finally {
      this.running = false;
    }
  }
}

export function buildRecommendationObservabilityV7PlayerIdentityRow(
  player: Pick<MatchPlayer, 'id' | 'matchId' | 'accountId'>,
): RecommendationObservabilityV7PlayerIdentityRow | undefined {
  const id = Number(player.id);
  const matchId = Number(player.matchId);
  const accountId = Number(player.accountId);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !Number.isSafeInteger(matchId) ||
    matchId <= 0 ||
    !Number.isSafeInteger(accountId) ||
    accountId <= 0 ||
    accountId > 0xffffffff
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    identityVersion: 'RECOMMENDATION_OBSERVABILITY_V7_DATASET_PLAYER_IDENTITY_1',
    matchId: String(matchId),
    datasetPlayerId: String(id),
    accountId: String(accountId),
    steamId: String(accountId),
    source: 'DIRECT_PERSISTED_IDENTITY',
    sourceField: 'match_players.accountId',
    identityDomain: 'STEAM_ACCOUNT_ID_U32',
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
