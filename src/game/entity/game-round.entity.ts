import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GameRoundStatus } from '../enum/game-round-status.enum';

@Entity()
@Index('game_round_status_index', ['status'])
@Index('game_round_created_at_index', ['createdAt'])
@Index('game_round_seed_hash_index', ['seedHash'], { unique: true })
export class GameRound {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_game_round',
  })
  id!: string;

  /**
   * Server seed used to derive the crash point.
   * Never sent to clients until the round crashes (provably fair).
   */
  @Column({ type: 'varchar', length: 128 })
  seed!: string;

  /**
   * SHA256(serverSeed) — published to clients before the round starts
   * so they can verify the crash point was predetermined.
   */
  @Column({ type: 'varchar', length: 128 })
  seedHash!: string;

  /**
   * Combined client seed: SHA256(sorted(playerSeeds).join(':'))
   * or "firecracker" if no players submitted seeds.
   * Set at transition to RUNNING, publicly revealed.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  clientSeed!: string | null;

  /**
   * Per-round sequence counter for provably fair verification.
   * Prevents seed reuse across rounds.
   */
  @Column({ type: 'bigint', default: 0 })
  nonce!: number;

  /**
   * The crash multiplier derived from HMAC-SHA256(serverSeed, clientSeed:nonce).
   * Secret until crash. Computed at transition to RUNNING.
   */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  crashPoint!: number | null;

  @Column({
    type: 'enum',
    enum: GameRoundStatus,
    enumName: 'game_round_status_enum',
    default: GameRoundStatus.WAITING,
  })
  status!: GameRoundStatus;

  /**
   * Timestamp when the WAITING phase ends and the rocket launches.
   */
  @Column({ type: 'timestamptz', nullable: true })
  waitingEndsAt!: Date | null;

  /**
   * Timestamp when the round transitioned to RUNNING.
   */
  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  /**
   * Timestamp when the round crashed.
   */
  @Column({ type: 'timestamptz', nullable: true })
  crashedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
