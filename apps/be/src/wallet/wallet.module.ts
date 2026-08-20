import { Module } from '@dunx/core';
import { WalletRepository } from './repos/wallet.repository.js';
import { WalletService } from './services/wallet.service.js';
import { WalletController } from './wallet.controller.js';

/**
 * Balances, their ledger, and the two routes that read them.
 *
 * It used to live inside `GameModule`, which had the dependency backwards: a
 * wallet is not part of the crash game any more than a user is. The game is one
 * caller of it.
 *
 * **Decorated, and it must stay decorated.** `forRoot()` returns a new object per
 * call and a scope is keyed on the module reference, so two importers would get
 * two scopes and two `WalletService`s. They would share one SQLite file, so the
 * balances would still come out right - but this is money, and the graph should
 * not be ambiguous about which instance moved it. There is nothing here to
 * configure, so there is nothing to buy with a factory.
 *
 * `WalletRepository` is deliberately **not** exported. `WalletService` is the seam
 * (see its doc comment): every method that moves money takes the caller's
 * transaction handle and stays synchronous, and the overdraft guard lives in the
 * repository's `UPDATE`. A module that could reach the repository could write a
 * balance without that guard, so it cannot reach it.
 *
 * No `AccountsModule` import for the controller's `CurrentUser`: that module is
 * `global: true`, so naming it here would buy nothing.
 */
@Module({
  controllers: [WalletController],
  providers: [WalletService, WalletRepository],
  exports: [WalletService],
})
export class WalletModule {}
