import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database/data-source';

async function main(): Promise<void> {
  const dataSource = new DataSource(databaseOptions);
  await dataSource.initialize();

  try {
    await dataSource.query(`
      ALTER TABLE "match_players"
      ADD COLUMN IF NOT EXISTS "accountId" bigint
    `);
    await dataSource.query(`
      CREATE INDEX IF NOT EXISTS "idx_match_players_match_account_id"
      ON "match_players" ("matchId", "accountId")
    `);

    const rows = (await dataSource.query(`
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'match_players'
            AND column_name = 'accountId'
            AND data_type = 'bigint'
        ) AS "columnReady",
        to_regclass('idx_match_players_match_account_id') IS NOT NULL AS "indexReady"
    `)) as Array<{ columnReady: boolean; indexReady: boolean }>;
    const columnReady = rows[0]?.columnReady === true;
    const indexReady = rows[0]?.indexReady === true;
    const report = {
      schemaVersion: 1,
      operation: 'RECOMMENDATION_OBSERVABILITY_V7_IDENTITY_SCHEMA',
      executorVersion: 'ACCOUNT_ID_COLUMN_AND_INDEX_ONLY_1',
      columnReady,
      indexReady,
      otherMigrationsExecuted: false,
      trainingPerformed: false,
      futureTestEvaluated: false,
      nextStep:
        columnReady && indexReady
          ? 'RUN_BOUNDED_IDENTITY_ONLY_RECOVERY'
          : 'STOP_AND_REVIEW_IDENTITY_SCHEMA_FAILURE',
    };
    console.log(JSON.stringify(report, null, 2));
    if (!columnReady || !indexReady) process.exitCode = 1;
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
