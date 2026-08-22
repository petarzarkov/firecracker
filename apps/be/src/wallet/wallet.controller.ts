import { Controller, Get, Post, type Input } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import type { Page } from '@dunx/infra/pagination';
import { CurrentUser } from '../auth/services/current-user.service.js';
import {
  listTransactions,
  walletQuery,
  type Wallet,
  type WalletTransaction,
} from './dto/wallet.dto.js';
import type {
  WalletRow,
  WalletTransactionRow,
} from './schema/wallet.schema.js';
import { WalletService } from './services/wallet.service.js';

/**
 * Balances and the ledger behind them.
 *
 * Every route is authenticated - there is no `@Public()` here, unlike the game
 * routes. A wallet belongs to the caller `AuthContext` resolved and to nobody
 * else, so no route takes a user id: `this.caller.require().id` is the only source,
 * which is what makes reading someone else's balance unexpressible rather than
 * merely forbidden.
 *
 * The deposit and withdrawal routes went with the billing module. What remains is
 * read-only plus the demo reset, because a demo balance is not money.
 */
@ApiDoc({
  tags: ['wallet'],
  description: 'The caller’s balances and their ledger.',
})
@Controller('wallet')
export class WalletController {
  static #mapTransaction(row: WalletTransactionRow): WalletTransaction {
    return {
      id: row.id,
      type: row.type,
      amountCents: row.amountCents,
      balanceAfterCents: row.balanceAfterCents,
      gameBetId: row.gameBetId,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
    };
  }

  static #mapWallet(wallet: WalletRow): Wallet {
    return {
      id: wallet.id,
      balanceCents: wallet.balanceCents,
      isDemo: wallet.isDemo,
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  constructor(
    private readonly wallets: WalletService,
    private readonly caller: CurrentUser,
  ) {}

  @ApiDoc({ tags: ['wallet'], summary: 'The caller’s balance' })
  @Get('/', walletQuery)
  balance(input: Input<typeof walletQuery>): Wallet {
    return WalletController.#mapWallet(
      this.wallets.getWallet(this.caller.require().id, input.query.isDemo),
    );
  }

  @ApiDoc({ tags: ['wallet'], summary: 'Ledger history, keyset paginated' })
  @Get('/transactions', listTransactions)
  async transactions(
    input: Input<typeof listTransactions>,
  ): Promise<Page<WalletTransaction>> {
    const page = await this.wallets.listTransactions(
      this.caller.require().id,
      input.query.isDemo,
      input.query,
    );
    return { ...page, data: page.data.map(WalletController.#mapTransaction) };
  }

  @ApiDoc({
    tags: ['wallet'],
    summary: 'Top the demo balance back up to its opening amount',
  })
  @Post('/demo/reset')
  resetDemo(): Wallet {
    return WalletController.#mapWallet(
      this.wallets.resetDemoWallet(this.caller.require().id),
    );
  }
}
