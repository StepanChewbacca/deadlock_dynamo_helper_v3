import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRecommendationEconomyRulesSnapshotsV11788568860000 implements MigrationInterface {
  name = 'CreateRecommendationEconomyRulesSnapshotsV11788568860000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recommendation_economy_rules_snapshots_v1" (
        "snapshotId" varchar(128) NOT NULL,
        "rulesetId" varchar(128) NOT NULL,
        "catalogSha256" char(64) NOT NULL,
        "source" varchar(256) NOT NULL,
        "contentSha256" char(64) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "payload" jsonb NOT NULL,
        "verifiedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_recommendation_economy_rules_snapshots_v1" PRIMARY KEY ("snapshotId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_recommendation_economy_rules_scope_v1"
      ON "recommendation_economy_rules_snapshots_v1" ("rulesetId", "catalogSha256", "active", "verifiedAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_recommendation_economy_rules_scope_v1"');
    await queryRunner.query('DROP TABLE IF EXISTS "recommendation_economy_rules_snapshots_v1"');
  }
}
