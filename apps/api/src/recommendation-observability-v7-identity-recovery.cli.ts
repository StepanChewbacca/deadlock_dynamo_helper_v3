import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { DataSource, IsNull } from 'typeorm';
import { databaseOptions } from './database/data-source';
import { MatchPlayer } from './deadlock-live/entities/match-player.entity';
import { RawMatchMetadata } from './deadlock-live/entities/raw-match-metadata.entity';
import { buildRecommendationObservabilityV7DirectIdentityIndex } from './deadlock-live/recommendation-observability-v7-direct-identity';
import { selectBestRawMatchMetadata } from './deadlock-live/raw-match-metadata.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

interface IdentityRecoveryCandidate {
  matchPlayerId: number;
  matchId: number;
  heroId: number;
  accountId: number;
  rawMetadataId: number;
}

async function main(): Promise<void> {
  const apply =
    process.env.DEADLOCK_RECOMMENDATION_OBSERVABILITY_V7_IDENTITY_RECOVERY_APPLY
      ?.trim()
      .toLowerCase() === 'true';
  const limit = boundedLimit(
    process.env.DEADLOCK_RECOMMENDATION_OBSERVABILITY_V7_IDENTITY_RECOVERY_LIMIT,
  );
  const requestedMatchIdsPath =
    process.env.DEADLOCK_RECOMMENDATION_OBSERVABILITY_V7_IDENTITY_RECOVERY_MATCH_IDS_PATH?.trim();
  const dataSource = new DataSource(databaseOptions);
  await dataSource.initialize();

  try {
    const migrationReady = await accountIdColumnExists(dataSource);
    if (!migrationReady) {
      const report = {
        schemaVersion: 1,
        operation: 'RECOMMENDATION_OBSERVABILITY_V7_IDENTITY_RECOVERY',
        executorVersion: 'IDENTITY_ONLY_RAW_METADATA_ACCOUNT_ID_2_EXPLICIT_SCOPE',
        mode: apply ? 'APPLY' : 'DRY_RUN',
        migrationReady: false,
        requestedLimit: limit,
        recoveryScope: requestedMatchIdsPath
          ? 'EXPLICIT_MATCH_ID_FILE'
          : 'MISSING_IDENTITY_MATCH_PREFIX',
        appliedMatchCount: 0,
        persistedAccountIdCount: 0,
        nextStep: 'RUN_IDENTITY_SCHEMA_STEP_BEFORE_IDENTITY_RECOVERY',
      };
      console.log(JSON.stringify(report, null, 2));
      if (apply) {
        throw new Error('match_players.accountId schema has not been applied.');
      }
      return;
    }

    const totalMissingPlayerCount = await countMissingPlayers(dataSource);
    const matchIds = requestedMatchIdsPath
      ? await readRecoveryMatchIds(requestedMatchIdsPath, limit)
      : await listMissingIdentityMatchIds(dataSource, limit);
    const metadataRepository = dataSource.getRepository(RawMatchMetadata);
    const matchPlayerRepository = dataSource.getRepository(MatchPlayer);
    const candidates: IdentityRecoveryCandidate[] = [];
    const recoverableMatchIds = new Set<number>();
    let missingMetadataMatchCount = 0;
    let conflictingMetadataHeroCount = 0;
    let metadataPlayerWithAccountIdCount = 0;
    let missingDirectAccountIdentityPlayerCount = 0;

    for (const matchId of matchIds) {
      const metadataCandidates = await metadataRepository.find({
        where: { matchId },
        order: { fetchedAt: 'DESC', id: 'DESC' },
      });
      const selected = selectBestRawMatchMetadata(metadataCandidates);
      if (!selected) {
        missingMetadataMatchCount += 1;
        continue;
      }

      const identityIndex =
        buildRecommendationObservabilityV7DirectIdentityIndex(selected.payload);
      conflictingMetadataHeroCount += identityIndex.conflictingHeroCount;
      metadataPlayerWithAccountIdCount += identityIndex.playerWithAccountIdCount;
      const missingPlayers = await matchPlayerRepository.find({
        where: { matchId, accountId: IsNull() },
        select: { id: true, matchId: true, heroId: true, accountId: true },
        order: { id: 'ASC' },
      });

      let recoverablePlayerCount = 0;
      for (const player of missingPlayers) {
        const heroId = Number(player.heroId);
        const accountId = identityIndex.byHeroId.get(heroId);
        if (accountId === undefined) {
          missingDirectAccountIdentityPlayerCount += 1;
          continue;
        }
        candidates.push({
          matchPlayerId: Number(player.id),
          matchId,
          heroId,
          accountId,
          rawMetadataId: Number(selected.id),
        });
        recoverablePlayerCount += 1;
      }
      if (recoverablePlayerCount > 0) recoverableMatchIds.add(matchId);
    }

    let appliedMatchCount = 0;
    let persistedAccountIdCount = 0;
    const appliedMatchIds = new Set<number>();
    const failures: Array<{
      matchPlayerId: number;
      matchId: number;
      heroId: number;
      message: string;
    }> = [];

    if (apply) {
      for (const candidate of candidates) {
        try {
          const result = await matchPlayerRepository.update(
            { id: candidate.matchPlayerId, accountId: IsNull() },
            { accountId: candidate.accountId },
          );
          if (Number(result.affected ?? 0) === 1) {
            persistedAccountIdCount += 1;
            appliedMatchIds.add(candidate.matchId);
          }
        } catch (error) {
          failures.push({
            matchPlayerId: candidate.matchPlayerId,
            matchId: candidate.matchId,
            heroId: candidate.heroId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      appliedMatchCount = appliedMatchIds.size;
    }

    const remainingMissingPlayerCount = apply
      ? await countMissingPlayers(dataSource)
      : totalMissingPlayerCount;
    const report = {
      schemaVersion: 1,
      operation: 'RECOMMENDATION_OBSERVABILITY_V7_IDENTITY_RECOVERY',
      executorVersion: 'IDENTITY_ONLY_RAW_METADATA_ACCOUNT_ID_2_EXPLICIT_SCOPE',
      mode: apply ? 'APPLY' : 'DRY_RUN',
      migrationReady: true,
      requestedLimit: limit,
      recoveryScope: requestedMatchIdsPath
        ? 'EXPLICIT_MATCH_ID_FILE'
        : 'MISSING_IDENTITY_MATCH_PREFIX',
      requestedMatchIdsPath,
      totalMissingPlayerCount,
      candidateMatchCount: matchIds.length,
      recoverableMatchCount: recoverableMatchIds.size,
      recoverablePlayerCount: candidates.length,
      missingMetadataMatchCount,
      conflictingMetadataHeroCount,
      metadataPlayerWithAccountIdCount,
      missingDirectAccountIdentityPlayerCount,
      appliedMatchCount,
      persistedAccountIdCount,
      remainingMissingPlayerCount,
      failureCount: failures.length,
      failures,
      contracts: {
        source: 'RAW_MATCH_METADATA_MATCH_INFO_PLAYERS_ACCOUNT_ID',
        persistencePath: 'MATCH_PLAYERS_ACCOUNT_ID_ONLY',
        canonicalRecordLocator: 'MATCH_ID_PLUS_HERO_ID_EXISTING_INGEST_KEY',
        matchPlayerNonIdentityFieldsModified: false,
        matchPlayerItemsModified: false,
        matchPlayerSkillUpgradesModified: false,
        matchRowsModified: false,
        rawMetadataRowsModified: false,
        netWorthMayRepresentWallet: false,
        historicalIdentityInferencePerformed: false,
        crossStreamHeroIdentityInferencePerformed: false,
        liveEventTeamIdentityJoinPerformed: false,
        playerPawnIdentityJoinPerformed: false,
        futureTestEvaluated: false,
        trainingPerformed: false,
      },
      nextStep:
        apply && failures.length === 0
          ? 'EXPORT_DIRECT_IDENTITY_SIDECAR_AND_REAUDIT_STAGE_J'
          : apply
            ? 'REVIEW_IDENTITY_ONLY_RECOVERY_FAILURES_BEFORE_RETRY'
            : 'APPLY_BOUNDED_IDENTITY_ONLY_RECOVERY_AFTER_DRY_RUN_REVIEW',
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

async function readRecoveryMatchIds(
  path: string,
  limit: number,
): Promise<number[]> {
  const content = await readFile(path, 'utf8');
  const values = content
    .split(/\r?\n/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return [...new Set(values)].slice(0, limit);
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
