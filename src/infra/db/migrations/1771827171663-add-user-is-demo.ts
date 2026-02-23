import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserIsDemo1771827171663 implements MigrationInterface {
  name = 'AddUserIsDemo1771827171663';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "is_demo" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "is_demo"`);
  }
}
