import { Module } from '@dunx/core';
import { WalletRepository } from './repos/wallet.repository.js';
import { WalletService } from './services/wallet.service.js';
import { WalletController } from './wallet.controller.js';

/**
 * Balances, their ledger, and the two routes that read them. Not part of
 * `GameModule`: a wallet is no more part of the crash game than a user is.
 *
 * **Decorated, and it must stay decorated** - two importers of a configured module
 * are two `WalletService`s, and the graph should not be ambiguous about which
 * instance moved money.
 *
 * `WalletRepository` is deliberately **not** exported: the overdraft guard lives in
 * its `UPDATE`, so a module that could reach it could write a balance without one.
 */
@Module({
  controllers: [WalletController],
  providers: [WalletService, WalletRepository],
  exports: [WalletService],
})
export class WalletModule {}
