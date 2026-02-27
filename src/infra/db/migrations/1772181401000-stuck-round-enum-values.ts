import { MigrationInterface, QueryRunner } from 'typeorm';

export class StuckRoundEnumValues1772181401000 implements MigrationInterface {
  name = 'StuckRoundEnumValues1772181401000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."game_round_status_enum" ADD VALUE IF NOT EXISTS 'failed'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."game_bet_status_enum" ADD VALUE IF NOT EXISTS 'refunded'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values.
    // To revert, drop and recreate the type manually after migrating data.
  }
}
