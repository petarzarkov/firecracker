import { MigrationInterface, QueryRunner } from 'typeorm';

export class DemoWalletAndBetColumns1772179281237
  implements MigrationInterface
{
  name = 'DemoWalletAndBetColumns1772179281237';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."game_bet_round_user_unique_index"`,
    );
    await queryRunner.query(`DROP INDEX "public"."wallet_user_id_index"`);
    await queryRunner.query(
      `ALTER TABLE "game_bet" ADD "is_demo" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet" ADD "is_demo" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet" DROP CONSTRAINT "FK_wallet_to_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet" DROP CONSTRAINT "REL_72548a47ac4a996cd254b08252"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "game_bet_round_user_demo_index" ON "game_bet" ("round_id", "user_id", "is_demo") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "wallet_user_id_is_demo_index" ON "wallet" ("user_id", "is_demo") `,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet" ADD CONSTRAINT "FK_wallet_to_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallet" DROP CONSTRAINT "FK_wallet_to_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."wallet_user_id_is_demo_index"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."game_bet_round_user_demo_index"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet" ADD CONSTRAINT "REL_72548a47ac4a996cd254b08252" UNIQUE ("user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet" ADD CONSTRAINT "FK_wallet_to_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "is_demo"`);
    await queryRunner.query(`ALTER TABLE "game_bet" DROP COLUMN "is_demo"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "wallet_user_id_index" ON "wallet" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "game_bet_round_user_unique_index" ON "game_bet" ("round_id", "user_id") `,
    );
  }
}
