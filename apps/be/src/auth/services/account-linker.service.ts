import { Logger, Module } from '@dunx/core';
import { and, eq } from 'drizzle-orm';
import { gameBets } from '../../game/betting/game-bet.schema.js';
import { files } from '../../files/schema/file.schema.js';
import type { AppSchema } from '../../infra/db/tx.js';
import { wallets } from '../../wallet/schema/wallet.schema.js';
import { SyncDatabase, transactionSync } from '@dunx/infra/db';

/**
 * Carrying a demo player's history onto the account they just made.
 *
 * `anonymous()` deletes the demo user the moment it links a real one, and every
 * table that references a user does so `onDelete: 'cascade'` - so converting used to
 * take the player's bets, their wallet and their uploaded avatar with it. Silently,
 * and at the exact moment they had decided to stick around.
 *
 * Runs inside better-auth's `onLinkAccount`, which is before the delete.
 */
export class AccountLinker {
  constructor(
    private readonly db: SyncDatabase<AppSchema>,
    private readonly logger: Logger,
  ) {}

  /**
   * Re-points everything the demo account owned at the real one.
   *
   * Synchronous and in one transaction, like every other write in this app: half a
   * migration would leave a player with their bets and somebody else's balance.
   */
  adopt(fromUserId: string, toUserId: string): void {
    if (fromUserId === toUserId) return;

    transactionSync(this.db, (tx) => {
      tx.update(gameBets)
        .set({ userId: toUserId })
        .where(eq(gameBets.userId, fromUserId))
        .run();

      tx.update(files)
        .set({ userId: toUserId })
        .where(eq(files.userId, fromUserId))
        .run();

      /**
       * Wallets move one at a time, and only into an empty slot.
       *
       * `wallet_user_id_is_demo_index` is unique over `(user_id, is_demo)`, so a
       * blanket update would collide the instant the new account had a wallet of
       * its own - which `getOrCreate` will have made if anything touched it during
       * sign-up. A fresh account has none, so in practice both move.
       */
      const held = tx
        .select({ id: wallets.id, isDemo: wallets.isDemo })
        .from(wallets)
        .where(eq(wallets.userId, fromUserId))
        .all();

      for (const wallet of held) {
        const taken = tx
          .select({ id: wallets.id })
          .from(wallets)
          .where(
            and(
              eq(wallets.userId, toUserId),
              eq(wallets.isDemo, wallet.isDemo),
            ),
          )
          .get();
        if (taken !== undefined) continue;

        tx.update(wallets)
          .set({ userId: toUserId })
          .where(eq(wallets.id, wallet.id))
          .run();
      }
    });

    this.logger.debug('demo account adopted', { fromUserId, toUserId });
  }
}

/**
 * Its own module, and `global: true`, because the consumer is inside another one.
 *
 * The `onLinkAccount` hook is built in `AccountsModule`'s factory but *runs* in the
 * scope `AuthModule.forRootAsync` creates, which cannot see a sibling's providers -
 * dunx says so at boot rather than handing back an undefined. One binding visible
 * everywhere is the documented answer; see `EventsPublisherModule`.
 */
@Module({ global: true, providers: [AccountLinker], exports: [AccountLinker] })
export class AccountLinkerModule {}
