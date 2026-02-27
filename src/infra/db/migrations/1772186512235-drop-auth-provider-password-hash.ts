import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropAuthProviderPasswordHash1772186512235
  implements MigrationInterface
{
  name = 'DropAuthProviderPasswordHash1772186512235';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_providers" DROP COLUMN "password_hash"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_providers" ADD "password_hash" character varying(128)`,
    );
  }
}
