# 04 — Data layer

Branch `refactor/architecture-sweep`. Scope: the five bullets below, `apps/be/src/infra/db/**`
and every `apps/be/src/**/repos/**`. Nothing here is a guess — the claims that decide the
design were each run against the real dependency tree before being written down:

| Claim | How it was checked |
| --- | --- |
| A subclass with no constructor of its own inherits the base's DI record | ran the four inheritance shapes through `bun --preload @dunx/transform/preload` and read `Symbol.for('dunx.deps')` off each class |
| A type-alias annotation is a boot error, not a typecheck error | same probe: the alias-annotated class recorded `{ unresolved: "db: Db" }` |
| A value-import of a type alias is caught earlier | `tsc` → `TS1484: 'Db' is a type and must be imported using a type-only import` |
| The two-tier `BaseRepository` compiles over all eight real tables | `tsc 7.0.2` with the root tsconfig's strict flags, all seven repositories restated against it, exit 0 |
| drizzle writes `updatedAt` without being passed it | in-memory `SyncSqliteOptions`, `set({ name })` only, `updated_at` advanced |
| Providers are constructed eagerly, before `listen()` | `@dunx/core`'s `AppFactory.create` awaits `injector.eager` in full, then `onInit`, and `main.ts` calls `app.listen()` afterwards |

---

## 1. Declare a db type and reuse it

### The distinction that has to be right

`@dunx/transform` does not read types. It slices the **source text of the annotation's
head** and emits that identifier in a value position
(`packages/transform/src/deps.ts`, `entryFor`):

```ts
const token = slice(source, annotation.typeName);   // "SyncDatabase", type args ignored
const cause = erased.get(token);                    // interface? alias? import type?
if (cause === undefined) return token;              // emitted as a value
```

`erased` is built by `collectTypeOnlyNames`, which records every `TSTypeAliasDeclaration`,
every `TSInterfaceDeclaration` and every `import type` name in the file. So:

- **The head of a constructor annotation must be a class or a `Token`.** A `type` alias
  there is recorded as `{ unresolved: "db: Db" }` and the container refuses to build the
  provider at boot. Proven:

  ```
  Base           -> [ "[class SyncDatabase]" ] | own record: true
  ChildNoCtor    -> [ "[class SyncDatabase]" ] | own record: false
  ChildOwnCtor   -> [ "[class SyncDatabase]" ] | own record: true
  ChildAliasCtor -> [ { unresolved: "db: Db" } ] | own record: true
  ```

- **Type *arguments* are never emitted.** `DbConnection<Db>` records `DbConnection`; the
  `Db` inside is erased before the transform ever looks. This is what makes the alias
  useful even on constructor parameters: the head stays `SyncDatabase`, the noise moves.

- **The typecheck catches the near miss.** Importing the alias as a value
  (`import { Db }`) fails with `TS1484` under `verbatimModuleSyntax`. Only the
  `import type { Db }` form reaches runtime, and that one fails at boot with the
  annotation quoted. Both are caught; one is caught later and louder.

### Can the token and the type share a name?

**No.** An alias named `SyncDatabase` would shadow the value import in every file that
declared it, and a file that imported both would not compile. More importantly it would
destroy the only signal a reader has: today `SyncDatabase` in an annotation head means
"this resolves through the container". Keep the names apart.

### The proposal

Two aliases, in `apps/be/src/infra/db/tx.ts` — the file that already owns "the handle a
repository actually needs" and already holds `DbHandle` and the single cast:

```ts
import type { SyncDatabase, SyncTransaction } from '@dunx/infra/db';
import type * as schema from './schema.js';

/** The drizzle schema as a type. Only ever a type *argument*. */
export type AppSchema = typeof schema;

/**
 * The injected drizzle handle.
 *
 * **Never the head of a constructor annotation.** `@dunx/transform` emits an
 * annotation's head as a value, and this is a type alias - so `db: Db` records
 * `{ unresolved: "db: Db" }` and the container refuses to build the class at boot,
 * naming it. A constructor writes `db: SyncDatabase<AppSchema>`; everything else -
 * return types, type arguments, generic defaults - writes `Db`.
 */
export type Db = SyncDatabase<AppSchema>;

export type DbHandle = Db | SyncTransaction<AppSchema>;

export class Tx {
  static asHandle(handle: DbHandle): Db {
    return handle as unknown as Db;
  }
}
```

`tx.ts` keeps `import type` on both dunx names, which is itself part of the guard: a file
that cannot name `SyncDatabase` as a value cannot host a constructor that injects it.

No new file, and no barrel move: `infra/db/schema.ts` stays exactly as it is. Putting
`AppSchema` there would mean the barrel importing itself.

### Every occurrence today

Sixteen literal `SyncDatabase<typeof schema>`, in nine files, at HEAD `55236e2` + branch:

| File | Line | Position | After |
| --- | --- | --- | --- |
| `infra/db/tx.ts` | 14 | `DbHandle` union member | `Db` |
| `infra/db/tx.ts` | 31 | `Tx.asHandle` return type | `Db` |
| `infra/db/tx.ts` | 35 | the one cast | `Db` |
| `infra/db/database.module.ts` | 29 | **ctor param**, as the type argument of `DbConnection<…>` | `DbConnection<Db>` |
| `infra/db/database.module.ts` | 42 | `raw` getter return type | `SqliteConnection<AppSchema, Db>['raw']` |
| `infra/db/database.module.ts` | 47 | the cast inside `raw` | `SqliteConnection<AppSchema, Db>` |
| `users/repos/users.repository.ts` | 29 | **ctor param head** | deleted — inherited from the base |
| `audit/repos/audit-log.repository.ts` | 19 | **ctor param head** | deleted |
| `files/repos/files.repository.ts` | 12 | **ctor param head** | deleted |
| `invites/repos/invites.repository.ts` | 17 | **ctor param head** | deleted |
| `game/repos/game-round.repository.ts` | 23 | **ctor param head** | deleted |
| `game/repos/game-bet.repository.ts` | 29 | **ctor param head** | deleted |
| `game/repos/wallet.repository.ts` | 15 | **ctor param head** | deleted |
| `auth/services/auth-admin.seeder.ts` | 27 | **ctor param head** | `SyncDatabase<AppSchema>` — head unchanged |
| `game/services/game-round.service.ts` | 38 | **ctor param head** | `SyncDatabase<AppSchema>` |
| `game/services/game-bet.service.ts` | 86 | **ctor param head** | `SyncDatabase<AppSchema>` |
| `infra/db/base.repository.ts` | new | **ctor param head** | `SyncDatabase<AppSchema>` — the only one left under `repos/` |

Also deleted: the seven `import * as schema from '../../infra/db/schema.js'` lines in the
repositories, which exist only to feed a `typeof`. The three services swap theirs for
`import type { AppSchema } from '../../infra/db/tx.js'`.

Net: `SyncDatabase<typeof schema>` goes to **zero occurrences**; `SyncDatabase` survives as
an annotation head in exactly four places, each of which is a class the container builds.

**Verdict: declare `AppSchema` and `Db` in `infra/db/tx.ts`. The alias is for return types,
type arguments and generic defaults; the head of a constructor annotation stays
`SyncDatabase<AppSchema>`, because the transform emits that head as a value and an alias
there is a boot error, not a typecheck error. The token and the type cannot share a name.**

---

## 2. A `BaseRepository` every repository extends

### What is actually common

Seven repositories, and only what more than one of them really does:

| | `findById` | other finders | `create` | `update` | `deleteById` | paginated read | `static over` | bespoke |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `UsersRepository` | ✅ | `findByEmail` | ✅ | ✅ | ✅ | `list` + 3 filters | — | — |
| `FilesRepository` | ✅ | — | ✅ | ✅ | ✅ | `list` + 2 filters | — | — |
| `InvitesRepository` | — | `findByEmail`, `findUsableByCode` | ✅ | ✅ | — | `list` + statuses | — | `accept`, `expireStale` |
| `AuditLogRepository` | — | — | — | — | — | `list` + 4 filters | — | — |
| `GameRoundRepository` | ✅ | `findCurrentRound`, `findRecentCrashes`, `findStuckRounds` | ✅ | ✅ | — | `list` | ✅ | `transition` |
| `GameBetRepository` | — | four finders + a join | ✅ | ✅ | — | `listByUser` | ✅ | `settleActiveBetsAsLost`, `playerNameFor`, `displayName` |
| `WalletRepository` | ✅ | `findByUserId` | — | — | — | `listTransactions` (a **second** table) | ✅ | `getOrCreate`, `debit`, `credit`, `recordTransaction`, `recentTransactions` |

Identical bodies, seven times: the constructor. Five times: `create`, `update`. Four times:
`findById`. Twice: `deleteById`. Seven times, differing only in the `where` expression: the
`paginate` call, always `orderBy: 'createdAt'`.

Nothing else. No `findAll`, no `count`, no `upsert`, no soft delete — nobody uses them.

### Two tiers, and the reason is an invariant rather than taste

A single write-capable base would hand `WalletRepository` a generic
`update(id, { balanceCents })` — a JavaScript-computed balance write, which is precisely
what CLAUDE.md forbids and what `debit`'s `WHERE balance_cents >= ?` exists to make
unexpressible. It would hand `AuditLogRepository` a `create`, in a module whose own doc
says the trail is written by SQLite and a caller reaching past the service is what the
trail records.

So: reads and the transaction binding in `BaseRepository`, writes in `CrudRepository`. The
two tables where an unguarded write would be a hole extend the read tier and **cannot
express one**.

```ts
// apps/be/src/infra/db/base.repository.ts
import { eq, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { SyncDatabase } from '@dunx/infra/db';
import { paginate, type Page, type PageOptions } from '@dunx/infra/pagination';
import { Tx, type AppSchema, type Db, type DbHandle } from './tx.js';

/** A table this base can address by primary key. Every table in the schema has one. */
export type Identified = SQLiteTable & { readonly id: SQLiteColumn };

/**
 * drizzle's `.get()` and `.all()` return a type conditional on the table, and
 * TypeScript cannot reduce it while the table is still a type parameter - it degrades
 * to `{ [x: string]: any }`. These two are that reduction, in one place, for the same
 * reason `Tx.asHandle` is one place: a cast that is unavoidable should be nameable.
 */
const one = <TRow>(value: unknown): TRow | undefined => value as TRow | undefined;
const many = <TRow>(value: unknown): TRow[] => value as TRow[];

/**
 * Reads, and the binding to a transaction handle.
 *
 * Synchronous, except the paginated read. That is not tidiness deferred: the bet path's
 * read-check-write is atomic *because* none of these can yield (see `GameBetService`),
 * so a method here becoming `async` would silently remove the guarantee that replaced
 * `pg_try_advisory_xact_lock`.
 */
export abstract class BaseRepository<
  TTable extends Identified,
  TRow extends Record<string, unknown> = TTable['$inferSelect'],
> {
  /**
   * The table this repository is over. A field rather than a constructor argument, so
   * a subclass needs no constructor - which is what lets it inherit the base's
   * dependency record instead of shadowing it. See `over` below.
   */
  protected abstract readonly table: TTable;

  /**
   * `SyncDatabase<AppSchema>`, spelled out. **Not `Db`**: `@dunx/transform` emits an
   * annotation's head as a value and `Db` is a type alias, so the alias here would
   * record `{ unresolved: "db: Db" }` and every repository in the app would fail to
   * build at boot. The type argument is erased before the transform sees it, which is
   * why `AppSchema` is fine.
   */
  constructor(protected readonly db: SyncDatabase<AppSchema>) {}

  /**
   * The same repository bound to a transaction handle.
   *
   * `this: new (db: Db) => TSelf` rather than a return type of `BaseRepository`: a
   * static factory that names its own class returns the base from every subclass, which
   * is the trap this shape avoids. `new this(...)` builds the receiver, so
   * `GameBetRepository.over(tx)` is a `GameBetRepository` at compile time and at run
   * time. A subclass that ever declares an extra constructor parameter stops satisfying
   * the `this` constraint and its `over()` call becomes a type error - which is correct,
   * because such a repository cannot be rebuilt from a handle alone.
   */
  static over<TSelf>(this: new (db: Db) => TSelf, handle: DbHandle): TSelf {
    return new this(Tx.asHandle(handle));
  }

  findById(id: string): TRow | undefined {
    return one<TRow>(
      this.db.select().from(this.table).where(eq(this.table.id, id)).get(),
    );
  }

  /**
   * Keyset page over this repository's own table.
   *
   * `orderBy` is stated rather than left to `paginate`'s default, which is the first of
   * `updatedAt`, `createdAt`, `id` the table has - so a table with `updatedAt` would
   * silently sort by last modification.
   *
   * Async only because `paginate` also serves `Bun.SQL`; see the note below on the
   * sync path landing upstream.
   */
  protected page(
    options: PageOptions,
    where?: SQL | undefined,
    orderBy = 'createdAt',
  ): Promise<Page<TRow>> {
    return paginate<TTable, TRow>({
      db: this.db,
      table: this.table,
      options,
      orderBy,
      where,
    });
  }
}

/**
 * The write half, for the tables where an unconditional write by id is the honest API.
 *
 * `wallet` and `audit_log` deliberately do not extend this: a generic `update` on a
 * balance is the JavaScript balance check CLAUDE.md forbids, and a `create` on the
 * audit log is a forged trail row.
 */
export abstract class CrudRepository<
  TTable extends Identified,
  TRow extends Record<string, unknown> = TTable['$inferSelect'],
  TNew extends Record<string, unknown> = TTable['$inferInsert'],
> extends BaseRepository<TTable, TRow> {
  create(values: TNew): TRow {
    return one<TRow>(
      this.db.insert(this.table).values(values).returning().get(),
    ) as TRow;
  }

  /**
   * `exactOptionalPropertyTypes` separates an absent key from an explicit `undefined`,
   * and a patch DTO produces the latter - so the value type has to admit it.
   *
   * No `updatedAt` in the set object, unlike the five copies this replaces. Every
   * `Columns.updatedAt()` carries `$onUpdate`, and drizzle's `buildUpdateSet` includes
   * any column with an `onUpdateFn` whether or not the caller passed it (measured: a
   * `set({ name })` advanced `updated_at`). Passing it also made this method wrong for
   * a table without the column, which is half of why the base is split in two.
   */
  update(
    id: string,
    values: { [K in keyof TNew]?: TNew[K] | undefined },
  ): TRow | undefined {
    return one<TRow>(
      this.db
        .update(this.table)
        .set(values)
        .where(eq(this.table.id, id))
        .returning()
        .get(),
    );
  }

  deleteById(id: string): boolean {
    return (
      many<TRow>(
        this.db.delete(this.table).where(eq(this.table.id, id)).returning().all(),
      ).length > 0
    );
  }
}
```

A repository then reads, in full:

```ts
export class FilesRepository extends CrudRepository<typeof files> {
  protected readonly table = files;

  list(filters: ListFilesFilters): Promise<Page<FileRow>> {
    const clauses: SQL[] = [];
    if (filters.userId !== undefined) clauses.push(eq(files.userId, filters.userId));
    if (filters.search !== undefined) {
      clauses.push(like(files.name, `%${filters.search}%`));
    }
    return this.page(filters, clauses.length === 0 ? undefined : and(...clauses));
  }
}
```

`FileRow` and `NewFileRow` need not be passed: they default to `TTable['$inferSelect']`
and `TTable['$inferInsert']`, and `findById` on the inference-only form returns
`FileRow | undefined` (verified). Pass them explicitly only where a row type is already
imported for another reason.

### How `over()` survives inheritance

Three things, and the first is the one that usually gets missed:

1. **The DI record is inherited, and dunx says so deliberately.** `@dunx/transform` writes
   `Object.defineProperty(Base, Symbol.for('dunx.deps'), …)` only on classes that declare
   a constructor, and `@dunx/core`'s reader is a plain property lookup —
   `packages/core/src/di/deps.ts`: *"Plain prototype-chain lookup rather than
   `Object.hasOwn`: a subclass that declares no constructor of its own inherits its
   base's, so it must inherit the base's dependencies with it."* Confirmed by probe:
   `ChildNoCtor` has no own record and still resolves `[SyncDatabase]`. **So no repository
   may declare a constructor.** One that does gets its own record, shadowing the base's,
   and must then re-annotate `db: SyncDatabase<AppSchema>` itself — which is why the table
   is an abstract field and not a constructor argument.
2. **The static's `this` parameter carries the subclass type.** `static over<TSelf>(this:
   new (db: Db) => TSelf, …): TSelf`. Verified through two levels of inheritance:
   `GameBetRepository.over(handle)` assigns to a `GameBetRepository` with no cast.
3. **The cast stays in `Tx.asHandle`.** Unchanged, still the only one, still for the
   reason `tx.ts` already documents.

`over()` is inherited by all seven. Three use it today. That is not speculative surface —
it is one method whose absence is what forced three copies.

### What stays bespoke

- `WalletRepository.listTransactions` paginates `wallet_transaction`, not its own table, so
  `page()` cannot serve it. It keeps its direct `paginate` call plus a line saying why.
- `GameBetRepository.findByRoundWithPlayers` (a join), `playerNameFor` (another table),
  `displayName` (a static rule).
- `GameRoundRepository.transition` — the guarded status change. Not `update` with extra
  arguments: the `from` status in the `WHERE` is what makes the crash job safe to retry.
- `InvitesRepository.accept` / `expireStale`, `GameBetRepository.settleActiveBetsAsLost`,
  `WalletRepository.getOrCreate` / `debit` / `credit` / `recordTransaction`. Every one of
  these is a guarded statement, and the guard is the point.

### The sync `paginate` arriving from workstream 07

The dunx tree is clean at `63ac16c`, so nothing has landed yet. Nothing in this plan
depends on it:

- **Works either way:** the base as written above, `page()` returning
  `Promise<Page<TRow>>`, every `list` staying `async`. This is the state to land in.
- **When it lands:** add `protected pageSync(...): Page<TRow>` beside `page`, switch each
  `list` to it, and drop the `Promise`. Callers need not change in the same commit —
  `await` on a non-promise is legal — so the controllers can be simplified after.
- **The only thing that would break** is a repository whose `list` had already been made
  synchronous while `paginate` was still async. Do not do that ahead of the upstream
  change.

**Verdict: feasible, and the shape is two tiers. `BaseRepository` (constructor, `table`,
`over`, `findById`, `page`) and `CrudRepository extends BaseRepository` (`create`,
`update`, `deleteById`); `WalletRepository` and `AuditLogRepository` extend the read tier
so that an unguarded balance write and a forged audit row stay unexpressible. `over()`
survives inheritance through a polymorphic `this` on the static, and every subclass must
stay constructor-free so it inherits the base's dependency record through the prototype
chain — which `@dunx/core` reads deliberately rather than by accident. The whole design
typechecks against all eight real tables under the repo's strict flags today.**

---

## 3. The wallet repository has no place in the game module

### What moves

A new top-level `apps/be/src/wallet/`, alongside `users/`, `invites/`, `files/`:

| From | To |
| --- | --- |
| `game/schema/wallet.schema.ts` | `wallet/schema/wallet.schema.ts` |
| `game/repos/wallet.repository.ts` | `wallet/repos/wallet.repository.ts` |
| `game/services/wallet.service.ts` | `wallet/services/wallet.service.ts` |
| `game/wallet.controller.ts` | `wallet/wallet.controller.ts` |
| `game/dto/game.dto.ts` → `Wallet`, `WalletTransaction`, `PaginatedTransactions`, `TRANSACTION_TYPES`, `DemoQuery`, `walletQuery`, `listTransactions` | `wallet/dto/wallet.dto.ts` |
| — | `wallet/wallet.module.ts` (new) |

`infra/db/schema.ts:13-17` re-points to `../../wallet/schema/wallet.schema.js`.

```ts
@Module({
  imports: [AccountsModule],          // CurrentUser, for the controller
  controllers: [WalletController],
  providers: [WalletService, WalletRepository],
  exports: [WalletService],           // WalletRepository stays private, deliberately
})
export class WalletModule {}
```

Decorated, not configured — there is nothing to vary, and `forRoot()` would be the two-
scopes-two-instances hazard, since both `AppModule` and `GameModule` import it.
`AppModule` imports it before `GameModule`; `GameModule` imports it for `WalletService`.

Table names, index names and the route prefix are untouched, so **no migration is
generated and none should be**: do not run `mig:gen` in this step. `openapi.spec.ts:74`
asserts `/api/wallet` and keeps passing because `@Controller('wallet')` does not move.
The zod `.meta({ id })` values stay identical, so the OpenAPI document is byte-identical.

`walletTransactions.gameBetId` keeps its `references(() => gameBets.id)`, so
`wallet/schema/wallet.schema.ts` imports `game/schema/game-bet.schema.js`. That is not the
wallet module depending on the game module: an FK is declared on the table holding the
column, drizzle needs the referenced table object, and every schema in this app already
imports `users` the same way. The module graph and the schema graph are separate.

### The seam — for workstream 02

**`WalletService` is the only wallet symbol the game may name.** After this change the
game imports no `WalletRepository`, no `wallets` table and no `WalletRow`;
`WalletTransactionType` comes from `@firecracker/contracts`, which is where it already
lives.

```ts
// wallet/services/wallet.service.ts — the whole of the seam

/** Outside a transaction: reads, and the demo top-up. */
getWallet(userId: string, isDemo?: boolean): WalletRow;               // creates on first sight
getBalanceCents(userId: string, isDemo?: boolean): number;
recentTransactions(userId: string, isDemo: boolean, limit?: number): WalletTransactionRow[];
listTransactions(userId: string, isDemo: boolean, options: PageOptions): Promise<Page<WalletTransactionRow>>;
resetDemoWallet(userId: string): WalletRow;

/**
 * Inside the caller's transaction. `tx` is first and required: money moves only in
 * somebody's transaction, and making the handle optional is how it stops being.
 */
findWallet(tx: DbHandle, userId: string, isDemo: boolean): WalletRow | undefined;

debit(
  tx: DbHandle,
  walletId: string,
  amountCents: number,
  type: WalletTransactionType,
  description: string,
  gameBetId: string | null,
): WalletRow | undefined;                                             // undefined = funds were not there

credit(
  tx: DbHandle,
  walletId: string,
  amountCents: number,
  type: WalletTransactionType,
  description: string,
  gameBetId: string | null,
): WalletRow;                                                        // throws if the row vanished
```

Every one of these is **synchronous** except `listTransactions`, and that is load-bearing:
`GameBetService` calls three of them between a `transactionSync` callback's first and last
statement, and the callback's return type refuses a promise.

What changes on the game side, in `game/services/game-bet.service.ts`:

```ts
// before
const walletRepo = WalletRepository.over(tx);
const wallet = walletRepo.findByUserId(userId, isDemo);
const debited = this.wallets.debit(wallet.id, amount, type, description, null, walletRepo);

// after
const wallet = this.wallets.findWallet(tx, userId, isDemo);
const debited = this.wallets.debit(tx, wallet.id, amount, type, description, null);
```

The trailing `repo: WalletRepository = this.wallets` parameter goes away, and with it the
dead `WalletService.scoped(tx)` — defined today and called by nothing, because
`GameBetService` builds `WalletRepository.over(tx)` itself. `WalletService` internally does
`WalletRepository.over(tx)`, which is the same call moved behind the boundary.

`resetDemoWallet` now opens its own `transactionSync`, because `debit`/`credit` require a
handle. That is a fix, not a tax: today the reset writes a balance and a ledger row with no
transaction around them, so an interruption between the two leaves a balance change with no
ledger entry. `WalletService` gains `SyncDatabase<AppSchema>` as a constructor parameter
for it — the head spelled out, not `Db`. A nested `transactionSync` takes a savepoint
(dunx documents this: `bun:sqlite` branches on `Database.inTransaction`), so the reset is
safe even if a caller ever wraps it.

### The three guarantees, and where each one still lives

The concurrency design that replaced `pg_try_advisory_xact_lock` is untouched by all of
this. Stated so it can be checked line by line at review:

1. **`transactionSync` cannot yield** — still opened by `GameBetService.placeBet` /
   `cashOut` over its own injected `SyncDatabase`. The transaction stays in the game
   module, because the game is what decides what one bet means. The seam only changes how
   the wallet's statements get the handle.
2. **The debit is guarded in SQL** — `WalletRepository.debit` keeps
   `.where(and(eq(wallets.id, walletId), gte(wallets.balanceCents, amountCents)))`
   verbatim, and `WalletRepository` no longer inherits a generic `update` that could route
   around it (see §2). `undefined` still means "the funds were not there", and
   `GameBetService` still turns that into `BetRejected`.
3. **`game_bet_round_user_demo_index` is unique** — `game-bet.schema.ts` does not move, the
   index name does not change, and `GameBetService.#isDuplicateBet` still matches on it.

Never a JavaScript balance check followed by an update. There is no step in this plan where
a balance is read into a variable, compared, and written back.

**Verdict: move the four files plus the wallet DTOs into a new top-level `wallet/` module
that exports only `WalletService`; `GameModule` imports it and keeps ownership of the
transaction. The seam is `WalletService`, whose money methods take the caller's `DbHandle`
as a required first argument and stay synchronous. All three replacements for the advisory
lock survive unchanged, and splitting the repository base in two is what keeps the second
one enforceable.**

---

## 4. Migrations sync and run at service startup

### What happens today

Three independent copies of "open SQLite and migrate":

1. **`DatabaseBootstrap`** (`infra/db/database.module.ts:27-51`) calls
   `migrate(this.connection.db, { migrationsFolder: MIGRATIONS_FOLDER })` and
   `AuditTriggers.apply(this.connection.raw)` **in its constructor**.
2. **`scripts/migrate.ts`** — `bun run mig:run`. Opens its own `SyncSqliteOptions` with
   `openSync()` and migrates.
3. **`scripts/seed.ts`** — `bun run seed`. Opens its own connection, migrates **again**,
   then `runSeeds`.

Is the boot path synchronous, and does it finish before traffic? Yes, and the chain is
worth stating because each link is load-bearing:

- `migrate` from `drizzle-orm/bun-sqlite/migrator` is declared `: void`. Nothing to await.
- `DatabaseBootstrap` is listed in `DatabaseModule.forRoot().providers`, and dunx resolves
  **eagerly**: `AppFactory.create` awaits `injector.resolve(token, scope)` for every
  non-lazy binding in module-import order, then runs every `onInit`, and only then returns
  (`packages/core/src/di/app.ts`). `main.ts` calls `app.listen(port)` after
  `HttpFactory.create` has returned. So the migrations are applied before the port binds,
  with no boot phase to coordinate.
- `DatabaseModule` is third in `Foundation.for(...)`, ahead of every feature module, so no
  repository is constructed against an unmigrated file.
- `DbModule.forRootAsync` settles the connection factory before the first constructor runs,
  which is what makes `this.connection.db` valid inside a constructor at all.
- The container's shutdown runs in reverse construction order, so the connection closes
  last. Nothing to change there.
- The deployed image runs `bun src/main.ts` (`apps/be/Dockerfile:79`) with no init step, and
  the emitted build copies `src/infra/db/migrations` to `dist/migrations` because
  `MIGRATIONS_FOLDER` is `import.meta.dir`-relative (`scripts/build.ts:49-55`). Both shapes
  work.

So the headline requirement is **already met**. Two real defects around it:

**Finding 1 — the scripts open with different pragmas.** `DatabaseBootstrap`'s connection
is built by `DatabaseModule.forRoot` with
`busy_timeout` → `journal_mode = WAL` → `foreign_keys = ON` → `synchronous = NORMAL`, in
that order, and the module's own comment explains at length that `busy_timeout` must come
first or the loser of a boot race dies on `SQLITE_BUSY` before any later pragma is applied.
Both scripts pass `['journal_mode = WAL', 'foreign_keys = ON']` — **no `busy_timeout` at
all**. So `bun run mig:run` against a database the app has open is exactly the failure that
comment describes, and `synchronous` silently differs too. Nobody has hit it because the
scripts are usually run against a stopped app.

**Finding 2 — every sandbox child re-migrates.** `jobs.processor.ts` boots `JobsModule`,
which goes through the same `Foundation.for(...)` and therefore constructs
`DatabaseBootstrap`. BullMQ forks one child per burst, so every burst runs `migrate()`
(a read of `__drizzle_migrations`) plus `AuditTriggers.apply` — and that includes
`CREATE TABLE IF NOT EXISTS _audit_ctx`, `INSERT OR IGNORE INTO _audit_ctx` and three
`CREATE TRIGGER IF NOT EXISTS`, which are DDL and take a write lock on the one file the
game loop is writing to. It is correct (idempotent, and `busy_timeout` covers the
contention) and it is unnecessary: a child is only ever forked by a parent that has already
migrated.

### The fix

One helper, three callers:

```ts
// apps/be/src/infra/db/sqlite.ts
/** The pragmas, in the order that matters. `busy_timeout` first - see DatabaseModule. */
export const pragmasFor = (busyTimeoutMs: number): readonly string[] => [
  `busy_timeout = ${busyTimeoutMs}`,
  'journal_mode = WAL',
  'foreign_keys = ON',
  'synchronous = NORMAL',
];

/** For a script with no container: the same file, opened the same way. */
export const openSqliteSync = (init: {
  filename: string;
  busyTimeoutMs?: number;
}): SyncSqliteConnection<AppSchema> => { … };
```

`DatabaseModule.forRoot`'s factory calls `pragmasFor(settings.busyTimeoutMs)`;
`scripts/migrate.ts` and `scripts/seed.ts` call `openSqliteSync`, which reads
`DB_BUSY_TIMEOUT_MS` with the same 5000 default the zod schema states. `MIGRATIONS_FOLDER`
stays exported from `database.module.ts` — it is the migrator's input, not the connection's.

For finding 2, `DatabaseModule.forRoot({ migrate: true })`, with `JobsModule` passing
`false`. `DatabaseModule` is already a configured module, so this adds no decorated-and-
configured hazard. This one is optional and easy to defer: it is a cost, not a bug.

**Verdict: migrations already run synchronously at startup and complete before the port
binds — `DatabaseBootstrap`'s constructor plus dunx's eager resolution is the mechanism,
and it is correct. Nothing needs building. Two defects to fix: the two scripts open the
database without `busy_timeout`, contradicting the pragma-order rule the module documents
at length, so extract one `pragmasFor`/`openSqliteSync` used by all three callers; and every
BullMQ sandbox child re-runs `migrate()` and re-applies the audit DDL on every burst, which
`DatabaseModule.forRoot({ migrate: false })` from `JobsModule` should stop.**

---

## 5. The admin seeder stays manual

Verified, and there are **two different things** called a seeder here. Keeping them apart is
the whole content of this section.

**`infra/db/seeds/` — manual, and confirmed manual.** `runSeeds` appears in exactly one
place in the repository: `apps/be/scripts/seed.ts`, behind `bun run seed`. Nothing in
`DatabaseBootstrap`, `DatabaseModule`, `AppModule`, `JobsModule`, the Dockerfile, either
compose file or `.github/workflows/ci.yml` invokes it. `scripts/seed.ts` migrates before
seeding, so the dependency points the safe way: the seed path pulls in migrations, the
migration path pulls in nothing. `0000_demo_users.seeder.ts` is additionally gated by its
own `when(env) => env !== 'production'`, and `runSeeds` journals each file in `dunx_seeds`
so a second run is a no-op.

**`AuthAdminSeeder` — runs at boot, on purpose, and is not part of the migration path.**
`auth/services/auth-admin.seeder.ts` implements `OnInit`, is listed in
`AccountsModule.providers`, is not exported, and returns immediately when
`config.get('isProd')`. In non-production it creates `AUTH_SEED_ADMIN_EMAIL` through
better-auth's own `api.signUpEmail` and promotes it. That path is *why* the drizzle seeder
no longer touches users: a row inserted directly has no `account` row and therefore no
password hash, so it can never sign in. `users.spec.ts:62`, `e2e/setup/context.ts:48` and
`e2e/utils/db-client.ts:18` all depend on that credential existing after boot.

If "the admin seeder stays manual" is read as *the drizzle seeds must not be wired into
startup*, that is today's state and this section is the contract that keeps it. If it is
read as *`AuthAdminSeeder` should not run at boot either*, that is a behaviour change which
breaks three test fixtures and every fresh dev environment, and it should be raised as its
own decision rather than folded into this workstream. Recommendation: leave it, because the
production guard is what makes it safe and a documented default admin in a deployed
environment is the thing worth refusing.

### The contract, for whoever refactors this next

- **`DatabaseBootstrap` migrates. It does not seed.** Do not add `runSeeds` to it, to
  `DatabaseModule`, to an `onInit` anywhere, or to the Dockerfile's `CMD`. Data is not
  schema: a migration is idempotent and required for the process to function, a seed is
  neither.
- **`bun run seed` is the only door to `infra/db/seeds/`.** A seed's `when` predicate is a
  second lock, not the first one.
- **`AuthAdminSeeder` is the only automatic seeder, it is `isProd`-gated, and it goes
  through better-auth rather than the table.** Anything that needs a signable credential
  belongs there; anything that needs rows belongs in `infra/db/seeds/`.

**Verdict: confirmed — nothing auto-seeds from the drizzle seeds directory, and the
migration path pulls in nothing from it. The one automatic seeder is `AuthAdminSeeder`,
which is a separate, production-refused, better-auth-mediated path that three test fixtures
depend on. No finding to fix; the contract above goes into CLAUDE.md's Database section so a
later refactor cannot "helpfully" wire seeding into startup.**

---

## Implementation plan

Commit-sized, ordered, each ending with `bun run typecheck` and `bun run test` green from
the repository root. Steps 4 and 5 may be pulled ahead of 2 and 3 if workstream 02 is
blocked on the seam — they do not overlap, and migrating `WalletRepository` onto the base
is a six-line diff wherever the file happens to live.

**Step 1 — the db type aliases.**
`infra/db/tx.ts` (add `AppSchema`, `Db`, re-point `DbHandle` and `Tx.asHandle`);
`infra/db/database.module.ts` (3 sites);
`users/repos/users.repository.ts`, `audit/repos/audit-log.repository.ts`,
`files/repos/files.repository.ts`, `invites/repos/invites.repository.ts`,
`game/repos/game-round.repository.ts`, `game/repos/game-bet.repository.ts`,
`game/repos/wallet.repository.ts` (annotation `SyncDatabase<AppSchema>`, drop
`import * as schema`);
`auth/services/auth-admin.seeder.ts`, `game/services/game-round.service.ts`,
`game/services/game-bet.service.ts` (same, heads unchanged).
Zero behaviour change. If a boot error names a provider here, an alias reached a
constructor head.

**Step 2 — the base classes and their test.**
New `infra/db/base.repository.ts` (as written in §2);
new `infra/db/base.repository.test.ts` — in-memory `SyncSqliteOptions().openSync()` plus
`migrate()`, no container: `create` → `findById` → `update` advances `updatedAt` without
being passed it → `deleteById` → `page()` walks a cursor → `over(tx)` inside
`transactionSync` commits, and rolls back on throw. The `updatedAt` assertion is the test
that would have caught dropping the explicit value if drizzle's `$onUpdate` ever changed.
Nothing else imports these yet.

**Step 3 — move the repositories onto the base.** One commit, seven files:
`users`, `files`, `invites`, `game-round`, `game-bet` → `CrudRepository`;
`audit-log`, `wallet` → `BaseRepository`. Every public signature stays identical, so
`game.spec.ts`, `users.spec.ts`, `files.spec.ts` and the e2e suite are the regression net.
`users.service.test.ts`'s `FakeRepo` is cast `as unknown as UsersRepository` and needs no
change. Delete the three `static over` bodies and the four `findById`, five `create`, five
`update`, two `deleteById` and seven `paginate` bodies the base now provides.

**Step 4 — extract the wallet module.** Move the four files and the wallet DTOs, add
`wallet/wallet.module.ts`, re-point `infra/db/schema.ts`, add `WalletModule` to
`AppModule.forRoot`'s imports and to `GameModule`'s, drop `WalletController`,
`WalletService` and `WalletRepository` from `GameModule`. Import sites to fix:
`game/game.gateway.ts:43`, `game/services/auto-cashout.service.ts:8`,
`game/services/game-bet.service.ts:11,16,18`, `game/dto/game.dto.ts:6`,
`game/game.spec.ts:11`. `WalletTransactionType` now comes from `@firecracker/contracts` in
the game files. No `mig:gen`.

**Step 5 — close the seam.** `wallet/services/wallet.service.ts`: `tx: DbHandle` becomes the
required first parameter of `debit`/`credit`, add `findWallet(tx, …)`, delete `scoped()`,
inject `SyncDatabase<AppSchema>` and wrap `resetDemoWallet` in `transactionSync`.
`game/services/game-bet.service.ts`: drop the `WalletRepository` import and the three
`WalletRepository.over(tx)` calls. Add to `game.spec.ts` the case that would have caught the
old reset: an interrupted `resetDemoWallet` leaves neither the balance nor the ledger row.
After this commit the game module names no wallet symbol other than `WalletService`, which
is what workstream 02 builds against.

**Step 6 — one way to open the database.** New `infra/db/sqlite.ts` with `pragmasFor` and
`openSqliteSync`; `infra/db/database.module.ts`, `scripts/migrate.ts` and `scripts/seed.ts`
all call it. Then, optionally and in the same commit,
`DatabaseModule.forRoot({ migrate })` with `JobsModule` passing `false`, and a
`jobs.processor.spec.ts` assertion that a child boots without touching the migrator.

**Step 7 — CLAUDE.md.** The Database section gains: the `AppSchema`/`Db` rule with the
boot-error reason, the two repository tiers and why `wallet` and `audit_log` are on the read
tier, the `wallet/` module and the `WalletService` seam, and the seeding contract from §5.
The `apps/be` layout tree gains `wallet/` and loses the wallet files from `game/`.
