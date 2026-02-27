import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientSeedAndNonce1772176547852 implements MigrationInterface {
  name = 'AddClientSeedAndNonce1772176547852';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game_round" ADD "client_seed" character varying(128)`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_round" ADD "nonce" bigint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_round" ALTER COLUMN "crash_point" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game_round" ALTER COLUMN "crash_point" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "game_round" DROP COLUMN "nonce"`);
    await queryRunner.query(
      `ALTER TABLE "game_round" DROP COLUMN "client_seed"`,
    );
  }
}
