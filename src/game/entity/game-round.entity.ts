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
   * sha256(seed) — published to clients before the round starts
   * so they can verify the crash point was predetermined.
   */
  @Column({ type: 'varchar', length: 128 })
  seedHash!: string;

  /**
   * The crash multiplier derived from seed. Secret until crash.
   */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  crashPoint!: number;

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
