import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database/data-source';
import { RawMatchMetadata } from './deadlock-live/entities/raw-match-metadata.entity';
import { RawMatchMetadataNormalizerService } from './deadlock-live/raw-match-metadata-normalizer.service';
import {
  RawMatchMetadataService,
  selectBestRawMatchMetadata,
} from './deadlock-live/raw-match-metadata.service';
import { StoredMatchReprocessingService } from './deadlock-live/stored-match-reprocessing.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

async function main(): Promise<void> {
  const apply =
    process.env.DEADLOCK_RECOMMENDATION_OBSERVABILITY_V7_IDENTITY_RECOVERY_APPLY
      ?.trim()
      .toLowerCase() === 'true';
  const limit = boundedLimit(
    process.env.DEADLOCK_RECOMMENDATION_OBSERVABILITY_V7_IDENTITY_RECOVERY_LIMIT,
  );
  const dataSource = new DataSource(databaseOptions);
  await dataSource.initialize();

  try {
    const migrationReady = await accountIdColumnExists(dataSource);
    if (!migrationReady) {
      const report = {
        schemaVersion: 1,
        operation: 'RECOMMENDATION_OBSERVABILITY_V7_IDENTITY_RECOVERY',
        mode: apply ? 'APPLY' : 'DRY_RUN',
        migrationReady: false,
        requestedLimit: limit,
        appliedMatchCount: 0,
        nextStep: 'RUN_DATABASE_MIGRATION_BEFORE_IDENTITY_RECOVERY',
      };
      console.log(JSON.stringify(report, null, 2));
      if (apply) {
        throw new Error('match_players.accountId migration has not been applied.');
      }
      return;
    }

    const totalMissingPlayerCount = await countMissingPlayers(dataSource);
    const matchIds = await listMissingIdentityMatchIds(dataSource, limit);
    const metadataRepository = dataSource.getRepository(RawMatchMetadata);
    const recoverableMatchIds: number[] = [];
    const rawMetadataByMatchId = new Map<number, RawMatchMetadata>();

    for (const matchId of matchIds) {
      const candidates = await metadataRepository.find({
        where: { matchId },
        order: { fetchedAt: 'DESC', id: 'DESC' },
      });
      const selected = selectBestRawMatchMetadata(candidates);
      if (!selected) continue;
      recoverableMatchIds.push(matchId);
      rawMetadataByMatchId.set(matchId, selected);
    }

    let appliedMatchCount = 0;
    let persistedAccountIdCount = 0;
    const failures: Array<{ matchId: number; message: string }> = [];
    if (apply) {
      const rawMetadataService = new RawMatchMetadataService(
        metadataRepository,
        {} as RawMatchMetadataNormalizerService,
      );
      const reprocessingService = new StoredMatchReprocessingService(
        dataSource,
        rawMetadataService,
      );
      for (const matchId of recoverableMatchIds) {
        try {
          const result = await reprocessingService.reprocessRawMetadata(
            rawMetadataByMatchId.get(matchId) as RawMatchMetadata,
          );
          appliedMatchCount += 1;
          persistedAccountIdCount += result.playerAccountIdsPersisted;
        } catch (error) {
          failures.push({
            matchId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const remainingMissingPlayerCount = apply
      ? await countMissingPlayers(dataSource)
      : totalMissingPlayerCount;
    const report = {
      schemaVersion: 1,
      operation: 'RECOMMENDATION_OBSERVABILITY_V7_IDENTITY_RECOVERY',
      executorVersion: 'CANONICAL_STORED_MATCH_REPROCESSING_1',
      mode: apply ? 'APPLY' : 'DRY_RUN',
      migrationReady: true,
      requestedLimit: limit,
      totalMissingPlayerCount,
      candidateMatchCount: matchIds.length,
      recoverableMatchCount: recoverableMatchIds.length,
      unrecoverableMatchCount: matchIds.length - recoverableMatchIds.length,
      appliedMatchCount,
      persistedAccountIdCount,
      remainingMissingPlayerCount,
      failureCount: failures.length,
      failures,
      contracts: {
        source: 'RAW_MATCH_METADATA_MATCH_INFO_PLAYERS_ACCOUNT_ID',
        persistencePath: 'STORED_MATCH_REPROCESSING_SERVICE',
        netWorthMayRepresentWallet: false,
        historicalIdentityInferencePerformed: false,
        liveEventHeroIdentityJoinPerformed: false,
        liveEventTeamIdentityJoinPerformed: false,
        playerPawnIdentityJoinPerformed: false,
        futureTestEvaluated: false,
        trainingPerformed: false,
      },
      nextStep:
        apply && failures.length === 0
          ? 'REFRESH_DIRECT_IDENTITY_SIDECAR_AND_REAUDIT_STAGE_J'
          : apply
            ? 'REVIEW_RECOVERY_FAILURES_BEFORE_RETRY'
            : 'SET_APPLY_TRUE_ONLY_AFTER_REVIEWING_DRY_RUN_SCOPE',
    };
    console.log(JSON.stringify(report, null, 2));
    if (apply && failures.length > 0) process.exitCode = 1;
  } finally {
    await dataSource.destroy();
  }
}

async function accountIdColumnExists(dataSource: DataSource): Promise<boolean> {
  const rows = (await dataSource.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'match_players'
        AND column_name = 'accountId'
    ) AS "exists"
  `)) as Array<{ exists: boolean }>;
  return rows[0]?.exists === true;
}

async function countMissingPlayers(dataSource: DataSource): Promise<number> {
  const rows = (await dataSource.query(`
    SELECT COUNT(*)::int AS "count"
    FROM "match_players"
    WHERE "accountId" IS NULL
  `)) as Array<{ count: number }>;
  return Number(rows[0]?.count ?? 0);
}

async function listMissingIdentityMatchIds(
  dataSource: DataSource,
  limit: number,
): Promise<number[]> {
  const rows = (await dataSource.query(
    `
      SELECT "matchId"
      FROM "match_players"
      WHERE "accountId" IS NULL
      GROUP BY "matchId"
      ORDER BY "matchId"
      LIMIT $1
    `,
    [limit],
  )) as Array<{ matchId: string | number }>;
  return rows
    .map((row) => Number(row.matchId))
    .filter((matchId) => Number.isSafeInteger(matchId) && matchId > 0);
}

function boundedLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
