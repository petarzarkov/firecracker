import { describe, expect, test } from 'bun:test';
import { buildScopes, collectModules, type Scope } from '@dunx/core';
import { ChatModule } from '../chat/chat.module.js';
import { WalletService } from '../wallet/services/wallet.service.js';
import { AutoCashOutService } from './betting/auto-cashout.service.js';
import { GameBettingModule } from './betting/betting.module.js';
import { GameBetRepository } from './betting/game-bet.repository.js';
import { GameBetService } from './betting/game-bet.service.js';
import { GameBotsModule } from './bots/bots.module.js';
import { GameEngineModule } from './engine/engine.module.js';
import { CrashEngineService } from './engine/crash-engine.service.js';
import { ClientSeedService } from './fairness/client-seed.service.js';
import { GameFairnessModule } from './fairness/fairness.module.js';
import { GameModule } from './game.module.js';
import { GameRoundService } from './rounds/game-round.service.js';
import { GameRoundsModule } from './rounds/rounds.module.js';
import { GameSurfaceModule } from './surface/surface.module.js';

/**
 * The three invariants the split turns from doc comments into properties of the
 * graph. `buildScopes` **constructs nothing**, so this needs no container, database
 * or Redis. It asserts on `scope.visible` rather than `app.get`, which is
 * deliberately permissive - it answers "is this in the graph", not "can that module
 * see it".
 */
const graph = buildScopes(GameModule);

const scopeOf = (module: object): Scope => {
  const scope = graph.scopes.get(module as never);
  if (scope === undefined) throw new Error('module is not in the game graph');
  return scope;
};

describe('bots cannot reach the money', () => {
  /**
   * A bot that placed real bets would be contributing entropy to the crash point
   * through the client-seed pool - the house deciding some of the players' seeds,
   * which is the thing provable fairness exists to rule out. `GameBotsService`'s
   * doc comment has always said so; this is what makes it true.
   */
  test.each([
    ['GameBetService', GameBetService],
    ['GameBetRepository', GameBetRepository],
    ['AutoCashOutService', AutoCashOutService],
    ['WalletService', WalletService],
    ['ClientSeedService', ClientSeedService],
    ['GameRoundService', GameRoundService],
  ])('%s is not visible in GameBotsModule', (_name, token) => {
    expect(scopeOf(GameBotsModule).visible.has(token)).toBe(false);
  });

  /**
   * And the reason it holds: `GameEngineModule` exports one class rather than
   * re-exporting the module it imports, so the round and betting scopes stop there.
   */
  test('all it can see of the game is the clock', () => {
    expect(scopeOf(GameBotsModule).visible.has(CrashEngineService)).toBe(true);
  });
});

/**
 * Chat is generic and the game is the application, so the dependency points one way.
 * An import in either direction undoes it - the shape to watch for is a chat service
 * reaching `GameBetRepository` for a display name, which `PlayerDirectory` exists to
 * make unnecessary.
 */
describe('chat does not depend on the game', () => {
  test.each([
    ['GameBetService', GameBetService],
    ['GameBetRepository', GameBetRepository],
    ['GameRoundService', GameRoundService],
    ['CrashEngineService', CrashEngineService],
  ])('%s is not visible in ChatModule', (_name, token) => {
    expect(scopeOf(ChatModule).visible.has(token)).toBe(false);
  });
});

describe('there is exactly one clock', () => {
  /**
   * The **same binding object**, which is what the instance cache is keyed on. Two
   * engines would each tick their own multiplier and each enqueue their own crash
   * job, and a client would see the number stutter between two timelines. This
   * fails the moment a sub-module gains a `forRoot()`, because then the two
   * importers get two scopes.
   */
  test('the bots and the surface share one engine binding', () => {
    expect(scopeOf(GameBotsModule).visible.get(CrashEngineService)).toBe(
      scopeOf(GameSurfaceModule).visible.get(CrashEngineService),
    );
  });

  /**
   * The same for the seed pool, where two instances would be two nonce counters -
   * monotonic anyway, since they `INCR` one key, but the clearest symptom of a
   * module that was configured when it had nothing to configure.
   */
  test('every importer of the seed pool shares one binding', () => {
    const seen = new Set(
      [GameRoundsModule, GameSurfaceModule].map((module) =>
        scopeOf(module).visible.get(ClientSeedService),
      ),
    );
    expect(seen.size).toBe(1);
  });

  test('the graph has no ambiguous import and no shadowed binding', () => {
    expect(graph.warnings).toEqual([]);
  });
});

describe('the two rules in the facade', () => {
  const modules = collectModules(GameModule);

  /**
   * A `global: true` sub-module is one edit from putting the engine in every BullMQ
   * fork: added to `Foundation.for()`, `JobsModule` would build it, and each fork
   * would be a second clock.
   */
  test('no sub-module is global', () => {
    expect(
      modules
        .filter((module) => module.options.global === true)
        .map((module) => module.name),
    ).toEqual([]);
  });

  /**
   * `forRoot()` returns a new object per call and a scope is keyed on the module
   * reference, so a configured module imported twice is two of everything it
   * provides. Nothing here has anything to configure.
   */
  test.each([
    ['GameModule', GameModule],
    ['GameFairnessModule', GameFairnessModule],
    ['GameBettingModule', GameBettingModule],
    ['GameRoundsModule', GameRoundsModule],
    ['GameEngineModule', GameEngineModule],
    ['GameBotsModule', GameBotsModule],
    ['GameSurfaceModule', GameSurfaceModule],
  ])('%s has no static factory', (_name, module) => {
    expect('forRoot' in module).toBe(false);
  });

  /**
   * The rule that makes a private job handler discoverable and `app.get` without a
   * `from` unambiguous: a provider class appears in exactly one `providers` array
   * in the whole graph.
   */
  test('no provider is declared by two modules', () => {
    const owners = new Map<unknown, string[]>();
    for (const scope of graph.ordered) {
      for (const token of scope.own.keys()) {
        owners.set(token, [...(owners.get(token) ?? []), scope.name]);
      }
    }

    expect(
      [...owners.entries()]
        .filter(([, names]) => names.length > 1)
        .map(([token, names]) => `${String(token)}: ${names.join(', ')}`),
    ).toEqual([]);
  });
});
