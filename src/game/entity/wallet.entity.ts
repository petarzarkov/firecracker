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

@Entity()
@Index('wallet_user_id_is_demo_index', ['userId', 'isDemo'], { unique: true })
export class Wallet {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_wallet',
  })
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  /**
   * Current balance in cents (e.g. 10000 = $100.00).
   * Never goes below 0.
   */
  @Column({ type: 'integer', default: 0 })
  balanceCents!: number;

  /**
   * Each user has two wallets: one real (isDemo=false) and one demo (isDemo=true).
   * Demo wallets are seeded with GAME.DEMO_INITIAL_BALANCE_CENTS on creation.
   */
  @Column({ type: 'boolean', default: false })
  isDemo!: boolean;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_wallet_to_user',
  })
  user!: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
