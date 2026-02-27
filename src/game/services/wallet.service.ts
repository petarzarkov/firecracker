import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { DataSource } from 'typeorm';
import type { ValidatedConfig } from '@/config/env.validation';
import { AppConfigService } from '@/config/services/app.config.service';
import { PageDto } from '@/core/pagination/dto/page.dto';
import { PageOptionsDto } from '@/core/pagination/dto/page-options.dto';
import { ContextLogger } from '@/infra/logger/services/context-logger.service';
import { Wallet } from '../entity/wallet.entity';
import { WalletTransaction } from '../entity/wallet-transaction.entity';
import { WalletTransactionType } from '../enum/wallet-transaction-type.enum';
import { WalletRepository } from '../repos/wallet.repository';
import { WalletTransactionRepository } from '../repos/wallet-transaction.repository';

@Injectable()
export class WalletService {
  private readonly stripeClient: Stripe | null;
  private readonly webhookSecret: string;

  constructor(
    private readonly configService: AppConfigService<ValidatedConfig>,
    private readonly walletRepo: WalletRepository,
    private readonly walletTxnRepo: WalletTransactionRepository,
    private readonly dataSource: DataSource,
    private readonly logger: ContextLogger,
  ) {
    const stripeConfig = this.configService.getOrThrow('stripe');
    this.stripeClient = stripeConfig.secretKey
      ? new Stripe(stripeConfig.secretKey, {
          apiVersion: '2026-01-28.clover',
          typescript: true,
        })
      : null;
    this.webhookSecret = stripeConfig.webhookSecret ?? '';
  }

  private get stripe(): Stripe {
    if (!this.stripeClient) {
      throw new InternalServerErrorException(
        'STRIPE_SECRET_KEY is not configured',
      );
    }
    return this.stripeClient;
  }

  async getWallet(userId: string, isDemo = false): Promise<Wallet> {
    return this.walletRepo.getOrCreate(userId, isDemo);
  }

  async getTransactions(
    userId: string,
    pageOptions: PageOptionsDto,
    isDemo = false,
  ): Promise<PageDto<WalletTransaction>> {
    const wallet = await this.walletRepo.findByUserId(userId, isDemo);
    if (!wallet) {
      return {
        data: [],
        meta: {
          take: pageOptions.take,
          hasNextPage: false,
          hasPreviousPage: false,
          nextCursor: null,
          previousCursor: null,
        },
      } as PageDto<WalletTransaction>;
    }
    return this.walletTxnRepo.findByWalletIdPaginated(wallet.id, pageOptions);
  }

  /**
   * Creates a Stripe PaymentIntent for wallet top-up.
   * Returns the clientSecret for client-side Stripe.js confirmation.
   */
  async createDepositSession(
    userId: string,
    userEmail: string,
    amountCents: number,
  ): Promise<{ clientSecret: string }> {
    if (amountCents < 100) {
      throw new BadRequestException('Minimum deposit is $1.00 (100 cents)');
    }

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      receipt_email: userEmail,
      metadata: {
        userId,
        type: 'wallet_deposit',
      },
    });

    if (!paymentIntent.client_secret) {
      throw new InternalServerErrorException(
        'Stripe did not return a client secret',
      );
    }

    this.logger.log('Wallet deposit session created', {
      userId,
      amountCents,
      paymentIntentId: paymentIntent.id,
    });

    return { clientSecret: paymentIntent.client_secret };
  }

  /**
   * Called when Stripe confirms a payment_intent.succeeded webhook
   * for a wallet_deposit. Idempotent via stripePaymentIntentId uniqueness.
   */
  async handleDepositWebhook(
    paymentIntentId: string,
    amountCents: number,
    userId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async manager => {
      // Idempotency: abort if already processed
      const existing = await manager.findOneBy(WalletTransaction, {
        stripePaymentIntentId: paymentIntentId,
      });
      if (existing) {
        this.logger.warn('Duplicate Stripe webhook — already processed', {
          paymentIntentId,
        });
        return;
      }

      const wallet = await this.walletRepo.getOrCreate(userId);
      await this.walletRepo.creditCents(wallet.id, amountCents, manager);

      const updatedWallet = await manager.findOneByOrFail(Wallet, {
        id: wallet.id,
      });

      const txn = this.walletTxnRepo.create({
        walletId: wallet.id,
        type: WalletTransactionType.DEPOSIT,
        amountCents,
        balanceAfterCents: updatedWallet.balanceCents,
        stripePaymentIntentId: paymentIntentId,
        description: 'Wallet top-up via Stripe',
      });
      await this.walletTxnRepo.save(txn, manager);

      this.logger.log('Wallet credited via Stripe deposit', {
        userId,
        amountCents,
        paymentIntentId,
        newBalance: updatedWallet.balanceCents,
      });
    });
  }

  /**
   * Initiates a withdrawal request. In v1 this records a pending withdrawal
   * for manual processing. The balance is deducted immediately.
   */
  async requestWithdrawal(userId: string, amountCents: number): Promise<void> {
    if (amountCents < 100) {
      throw new BadRequestException('Minimum withdrawal is $1.00 (100 cents)');
    }

    await this.dataSource.transaction(async manager => {
      const wallet = await this.walletRepo.getOrCreate(userId);

      const affected = await this.walletRepo.debitCents(
        wallet.id,
        amountCents,
        manager,
      );

      if (affected === 0) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      const updatedWallet = await manager.findOneByOrFail(Wallet, {
        id: wallet.id,
      });

      const txn = this.walletTxnRepo.create({
        walletId: wallet.id,
        type: WalletTransactionType.WITHDRAWAL,
        amountCents,
        balanceAfterCents: updatedWallet.balanceCents,
        description: 'Withdrawal request — pending manual processing',
      });
      await this.walletTxnRepo.save(txn, manager);

      this.logger.log('Withdrawal requested', {
        userId,
        amountCents,
        remainingBalance: updatedWallet.balanceCents,
      });
    });
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }
}
