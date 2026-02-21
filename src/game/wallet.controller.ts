import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ApiJwtAuth } from '@/core/decorators/api-jwt-auth.decorator';
import { CurrentUser } from '@/core/decorators/current-user.decorator';
import { Public } from '@/core/decorators/public.decorator';
import { PageDto } from '@/core/pagination/dto/page.dto';
import { PaginatedDto } from '@/core/pagination/dto/paginated.dto';
import { SanitizedUser } from '@/users/entity/user.entity';
import {
  CreateDepositSessionDto,
  DepositSessionResponseDto,
  ListTransactionsQueryDto,
  WalletResponseDto,
  WalletTransactionResponseDto,
  WithdrawDto,
} from './dto/wallet.dto';
import { Wallet } from './entity/wallet.entity';
import { WalletTransaction } from './entity/wallet-transaction.entity';
import { WalletService } from './services/wallet.service';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Get current wallet balance' })
  @ApiOkResponse({ type: WalletResponseDto })
  async getWallet(
    @CurrentUser() user: SanitizedUser,
  ): Promise<WalletResponseDto> {
    const wallet = await this.walletService.getWallet(user.id);
    return this.#mapWallet(wallet);
  }

  @Get('transactions')
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Paginated wallet transaction history' })
  @ApiOkResponse({ type: PaginatedDto(WalletTransaction) })
  async getTransactions(
    @CurrentUser() user: SanitizedUser,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<PageDto<WalletTransactionResponseDto>> {
    const page = await this.walletService.getTransactions(user.id, query);
    return {
      ...page,
      data: page.data.map(t => this.#mapTransaction(t)),
    };
  }

  @Post('deposit/session')
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Create a Stripe PaymentIntent for wallet top-up',
    description:
      'Returns a `clientSecret` for use with Stripe.js `stripe.confirmCardPayment()`.',
  })
  @ApiOkResponse({ type: DepositSessionResponseDto })
  async createDepositSession(
    @CurrentUser() user: SanitizedUser,
    @Body() dto: CreateDepositSessionDto,
  ): Promise<DepositSessionResponseDto> {
    return this.walletService.createDepositSession(
      user.id,
      user.email,
      dto.amountCents,
    );
  }

  @Post('withdraw')
  @ApiJwtAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Request a withdrawal (v1: manual processing)',
    description:
      'Deducts balance immediately. Payouts are processed manually in v1.',
  })
  async requestWithdrawal(
    @CurrentUser() user: SanitizedUser,
    @Body() dto: WithdrawDto,
  ): Promise<void> {
    await this.walletService.requestWithdrawal(user.id, dto.amountCents);
  }

  /**
   * Stripe webhook — no JWT auth required (signed with webhook secret).
   * Must receive raw body for signature verification.
   */
  @Post('webhook/stripe')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook handler for wallet deposits' })
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: boolean }> {
    const sig = req.headers['stripe-signature'] as string;
    const rawBody = req.rawBody;

    if (!rawBody || !sig) {
      return { received: false };
    }

    const event = this.walletService.constructWebhookEvent(rawBody, sig);

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as {
        id: string;
        amount: number;
        metadata: { userId?: string; type?: string };
      };

      if (pi.metadata?.type === 'wallet_deposit' && pi.metadata?.userId) {
        await this.walletService.handleDepositWebhook(
          pi.id,
          pi.amount,
          pi.metadata.userId,
        );
      }
    }

    return { received: true };
  }

  #mapWallet(w: Wallet): WalletResponseDto {
    return {
      id: w.id,
      userId: w.userId,
      balanceCents: w.balanceCents,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    };
  }

  #mapTransaction(t: WalletTransaction): WalletTransactionResponseDto {
    return {
      id: t.id,
      walletId: t.walletId,
      type: t.type,
      amountCents: t.amountCents,
      balanceAfterCents: t.balanceAfterCents,
      stripePaymentIntentId: t.stripePaymentIntentId ?? undefined,
      gameBetId: t.gameBetId ?? undefined,
      description: t.description ?? undefined,
      createdAt: t.createdAt,
    };
  }
}
