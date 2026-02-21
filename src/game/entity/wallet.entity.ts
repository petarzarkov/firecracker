import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '@/users/entity/user.entity';

@Entity()
@Index('wallet_user_id_index', ['userId'], { unique: true })
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

  @OneToOne(() => User, { onDelete: 'CASCADE' })
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
