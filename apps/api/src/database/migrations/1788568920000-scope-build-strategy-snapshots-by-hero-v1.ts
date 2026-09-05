import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeBuildStrategySnapshotsByHeroV11788568920000 implements MigrationInterface {
  name = 'ScopeBuildStrategySnapshotsByHeroV11788568920000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "build_strategy_snapshots_v1"
      ADD COLUMN IF NOT EXISTS "heroId" integer
    `);

    // Prototype rows written before hero-scoped persistence cannot be split safely because their
    // content hash covers the complete JSON payload. They are derived artifacts and are re-mined.
    await queryRunner.query(`
      DELETE FROM "build_strategy_snapshots_v1"
      WHERE "heroId" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "build_strategy_snapshots_v1"
      ALTER COLUMN "heroId" SET NOT NULL
    `);

    await queryRunner.query('DROP INDEX IF EXISTS "idx_build_strategy_snapshot_scope_v1"');
    await queryRunner.query(`
      CREATE INDEX "idx_build_strategy_snapshot_scope_v1"
      ON "build_strategy_snapshots_v1" ("heroId", "rulesetId", "patchId", "catalogSha256", "active", "publishedAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_build_strategy_snapshot_scope_v1"');
    await queryRunner.query(`
      CREATE INDEX "idx_build_strategy_snapshot_scope_v1"
      ON "build_strategy_snapshots_v1" ("rulesetId", "catalogSha256", "active", "publishedAt")
    `);
    await queryRunner.query(`
      ALTER TABLE "build_strategy_snapshots_v1"
      DROP COLUMN IF EXISTS "heroId"
    `);
  }
}
