import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGameModule1771672844994 implements MigrationInterface {
  name = 'AddGameModule1771672844994';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "wallet" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "balance_cents" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_72548a47ac4a996cd254b08252" UNIQUE ("user_id"), CONSTRAINT "PK_wallet" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "wallet_user_id_index" ON "wallet" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."game_round_status_enum" AS ENUM('waiting', 'running', 'crashed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "game_round" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "seed" character varying(128) NOT NULL, "seed_hash" character varying(128) NOT NULL, "crash_point" numeric(10,2) NOT NULL, "status" "public"."game_round_status_enum" NOT NULL DEFAULT 'waiting', "waiting_ends_at" TIMESTAMP WITH TIME ZONE, "started_at" TIMESTAMP WITH TIME ZONE, "crashed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_game_round" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "game_round_seed_hash_index" ON "game_round" ("seed_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "game_round_created_at_index" ON "game_round" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "game_round_status_index" ON "game_round" ("status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."game_bet_status_enum" AS ENUM('active', 'cashed_out', 'lost')`,
    );
    await queryRunner.query(
      `CREATE TABLE "game_bet" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "round_id" uuid NOT NULL, "user_id" uuid NOT NULL, "bet_amount_cents" integer NOT NULL, "cashed_out_at" numeric(10,2), "payout_cents" integer, "status" "public"."game_bet_status_enum" NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_game_bet" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "game_bet_status_index" ON "game_bet" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "game_bet_user_id_index" ON "game_bet" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "game_bet_round_id_index" ON "game_bet" ("round_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."wallet_transaction_type_enum" AS ENUM('deposit', 'withdrawal', 'bet_debit', 'win_credit', 'refund')`,
    );
    await queryRunner.query(
      `CREATE TABLE "wallet_transaction" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "wallet_id" uuid NOT NULL, "type" "public"."wallet_transaction_type_enum" NOT NULL, "amount_cents" integer NOT NULL, "balance_after_cents" integer NOT NULL, "stripe_payment_intent_id" character varying(128), "game_bet_id" uuid, "description" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_wallet_transaction" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "wallet_transaction_stripe_pi_index" ON "wallet_transaction" ("stripe_payment_intent_id") WHERE "stripe_payment_intent_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "wallet_transaction_type_index" ON "wallet_transaction" ("type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "wallet_transaction_wallet_id_index" ON "wallet_transaction" ("wallet_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet" ADD CONSTRAINT "FK_wallet_to_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_bet" ADD CONSTRAINT "FK_game_bet_to_game_round" FOREIGN KEY ("round_id") REFERENCES "game_round"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_bet" ADD CONSTRAINT "FK_game_bet_to_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_transaction" ADD CONSTRAINT "FK_wallet_transaction_to_wallet" FOREIGN KEY ("wallet_id") REFERENCES "wallet"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_transaction" ADD CONSTRAINT "FK_wallet_transaction_to_game_bet" FOREIGN KEY ("game_bet_id") REFERENCES "game_bet"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallet_transaction" DROP CONSTRAINT "FK_wallet_transaction_to_game_bet"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_transaction" DROP CONSTRAINT "FK_wallet_transaction_to_wallet"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_bet" DROP CONSTRAINT "FK_game_bet_to_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_bet" DROP CONSTRAINT "FK_game_bet_to_game_round"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet" DROP CONSTRAINT "FK_wallet_to_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."wallet_transaction_wallet_id_index"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."wallet_transaction_type_index"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."wallet_transaction_stripe_pi_index"`,
    );
    await queryRunner.query(`DROP TABLE "wallet_transaction"`);
    await queryRunner.query(
      `DROP TYPE "public"."wallet_transaction_type_enum"`,
    );
    await queryRunner.query(`DROP INDEX "public"."game_bet_round_id_index"`);
    await queryRunner.query(`DROP INDEX "public"."game_bet_user_id_index"`);
    await queryRunner.query(`DROP INDEX "public"."game_bet_status_index"`);
    await queryRunner.query(`DROP TABLE "game_bet"`);
    await queryRunner.query(`DROP TYPE "public"."game_bet_status_enum"`);
    await queryRunner.query(`DROP INDEX "public"."game_round_status_index"`);
    await queryRunner.query(
      `DROP INDEX "public"."game_round_created_at_index"`,
    );
    await queryRunner.query(`DROP INDEX "public"."game_round_seed_hash_index"`);
    await queryRunner.query(`DROP TABLE "game_round"`);
    await queryRunner.query(`DROP TYPE "public"."game_round_status_enum"`);
    await queryRunner.query(`DROP INDEX "public"."wallet_user_id_index"`);
    await queryRunner.query(`DROP TABLE "wallet"`);
  }
}
