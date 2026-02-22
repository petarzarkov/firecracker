import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '@/users/entity/user.entity';
import { GameBetStatus } from '../enum/game-bet-status.enum';
import { GameRound } from './game-round.entity';

@Entity()
@Index('game_bet_round_id_index', ['roundId'])
@Index('game_bet_user_id_index', ['userId'])
@Index('game_bet_status_index', ['status'])
@Index('game_bet_round_user_unique_index', ['roundId', 'userId'], {
  unique: true,
})
export class GameBet {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_game_bet',
  })
  id!: string;

  @Column({ type: 'uuid' })
  roundId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  /**
   * Bet amount in cents (e.g. 500 = $5.00).
   */
  @Column({ type: 'integer' })
  betAmountCents!: number;

  /**
   * The multiplier value at which the player cashed out.
   * Null if they did not cash out (lost).
   */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cashedOutAt!: number | null;

  /**
   * Payout in cents: floor(betAmountCents × cashedOutAt).
   * Null if the bet was lost.
   */
  @Column({ type: 'integer', nullable: true })
  payoutCents!: number | null;

  @Column({
    type: 'enum',
    enum: GameBetStatus,
    enumName: 'game_bet_status_enum',
    default: GameBetStatus.ACTIVE,
  })
  status!: GameBetStatus;

  @ManyToOne(() => GameRound, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'round_id',
    foreignKeyConstraintName: 'FK_game_bet_to_game_round',
  })
  round!: GameRound;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_game_bet_to_user',
  })
  user!: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
