import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WalletTransactionType } from '../enum/wallet-transaction-type.enum';
import { GameBet } from './game-bet.entity';
import { Wallet } from './wallet.entity';

@Entity()
@Index('wallet_transaction_wallet_id_index', ['walletId'])
@Index('wallet_transaction_type_index', ['type'])
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_wallet_transaction',
  })
  id!: string;

  @Column({ type: 'uuid' })
  walletId!: string;

  @Column({
    type: 'enum',
    enum: WalletTransactionType,
    enumName: 'wallet_transaction_type_enum',
  })
  type!: WalletTransactionType;

  /**
   * Always positive. Direction is determined by `type`.
   * BET_DEBIT / WITHDRAWAL decrease balance; DEPOSIT / WIN_CREDIT / REFUND increase it.
   */
  @Column({ type: 'integer' })
  amountCents!: number;

  /**
   * Snapshot of wallet balance after this transaction (audit trail).
   */
  @Column({ type: 'integer' })
  balanceAfterCents!: number;

  /**
   * Stripe PaymentIntent ID — set for DEPOSIT transactions.
   * Unique partial index enforces idempotency.
   */
  @Index('wallet_transaction_stripe_pi_index', {
    unique: true,
    where: '"stripe_payment_intent_id" IS NOT NULL',
  })
  @Column({ type: 'varchar', length: 128, nullable: true })
  stripePaymentIntentId!: string | null;

  /**
   * Related game bet — set for BET_DEBIT and WIN_CREDIT transactions.
   */
  @Column({ type: 'uuid', nullable: true })
  gameBetId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @ManyToOne(() => Wallet, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'wallet_id',
    foreignKeyConstraintName: 'FK_wallet_transaction_to_wallet',
  })
  wallet!: Wallet;

  @ManyToOne(() => GameBet, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'game_bet_id',
    foreignKeyConstraintName: 'FK_wallet_transaction_to_game_bet',
  })
  gameBet!: GameBet | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
