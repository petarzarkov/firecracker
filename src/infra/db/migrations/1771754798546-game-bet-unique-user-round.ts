import { MigrationInterface, QueryRunner } from 'typeorm';

export class GameBetUniqueUserRound1771754798546 implements MigrationInterface {
  name = 'GameBetUniqueUserRound1771754798546';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "game_bet_round_user_unique_index" ON "game_bet" ("round_id", "user_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."game_bet_round_user_unique_index"`,
    );
  }
}
