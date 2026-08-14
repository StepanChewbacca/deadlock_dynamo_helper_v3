import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMatchPlayerAccountIdentity1786712400000
  implements MigrationInterface
{
  name = 'AddMatchPlayerAccountIdentity1786712400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "match_players"
      ADD COLUMN IF NOT EXISTS "accountId" bigint
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_match_players_match_account_id"
      ON "match_players" ("matchId", "accountId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_match_players_match_account_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "match_players"
      DROP COLUMN IF EXISTS "accountId"
    `);
  }
}
