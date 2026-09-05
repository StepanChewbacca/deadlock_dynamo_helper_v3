import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBuildStrategySnapshotsV11788568800000 implements MigrationInterface {
  name = 'CreateBuildStrategySnapshotsV11788568800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "build_strategy_snapshots_v1" (
        "snapshotId" varchar(128) NOT NULL,
        "rulesetId" varchar(128) NOT NULL,
        "patchId" varchar(128) NOT NULL,
        "catalogSha256" char(64) NOT NULL,
        "sourceSha256" char(64) NOT NULL,
        "contentSha256" char(64) NOT NULL,
        "schemaVersion" varchar(32) NOT NULL DEFAULT 'build-strategy-v1',
        "active" boolean NOT NULL DEFAULT true,
        "payload" jsonb NOT NULL,
        "publishedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_build_strategy_snapshots_v1" PRIMARY KEY ("snapshotId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_build_strategy_snapshot_scope_v1"
      ON "build_strategy_snapshots_v1" ("rulesetId", "catalogSha256", "active", "publishedAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_build_strategy_snapshot_scope_v1"');
    await queryRunner.query('DROP TABLE IF EXISTS "build_strategy_snapshots_v1"');
  }
}
