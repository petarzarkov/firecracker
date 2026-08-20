import { describe, expect, test } from 'bun:test';
import type { Page as DunxPage } from '@dunx/infra/pagination';
import type { GameBetView, Page } from '@firecracker/contracts';
import { GameBet } from './game.dto.js';

/**
 * The zod schema and the interface the browser reads are two declarations of one
 * response, and this is what stops them parting ways.
 *
 * They have to be two: the schema is server-side because sharing it would put zod
 * in the browser bundle, and it carries `.meta({ id })` for the OpenAPI document.
 * Nothing compared them before, and `crashPoint` is what that cost - the client
 * declared the field, rendered `(crashPoint ?? 0).toFixed(2)`, and no route had
 * ever sent it, so every lost bet read as a crash at zero.
 *
 * `Mutual` is checked by `bun run typecheck`, not by `bun test`: a field on one
 * side and not the other makes the `true` below a `false` and the annotation fails
 * to compile, naming this file. The runtime test underneath is the other half -
 * that an inhabitant of the interface really does satisfy the schema, which a
 * type-level check cannot say anything about.
 */

/**
 * Both ways assignable **and** the same keys.
 *
 * Mutual assignability alone is not enough, and `crashPoint` is why: an optional
 * property present on one side and absent on the other is assignable in both
 * directions, so the check that was meant to catch this exact field would have
 * passed without it. The key sets have to be compared too.
 */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

type Mutual<A, B> =
  SameKeys<A, B> extends true
    ? A extends B
      ? B extends A
        ? true
        : false
      : false
    : false;

const betShapesAgree: Mutual<GameBet, GameBetView> = true;

/**
 * And the envelope around it. `@dunx/infra/pagination` owns the real one; the lib
 * restates it because a browser cannot import from a server package, and a client
 * that read `meta.nextCursor` off the wrong shape would silently stop paging.
 */
const pageShapesAgree: Mutual<DunxPage<GameBet>, Page<GameBetView>> = true;

describe('the my-bets response', () => {
  test('the schema and the shared interface describe the same row', () => {
    expect([betShapesAgree, pageShapesAgree]).toEqual([true, true]);
  });

  /**
   * A settled bet, spelled out as the client's own type and handed to the server's
   * schema. `crashPoint` is present here because the round crashed; the spec in
   * `game.spec.ts` covers it being absent while the round is still running.
   */
  test('a settled row satisfies the schema it is validated against', () => {
    const view: GameBetView = {
      id: '7f5f5c4c-7b0e-4a1a-9b0a-2b6c0f8e1d11',
      roundId: 'f1c2b3a4-5d6e-4f70-8a9b-0c1d2e3f4a5b',
      userId: '0a1b2c3d-4e5f-4061-8273-849506a7b8c9',
      betAmountCents: 500,
      status: 'lost',
      cashedOutAt: null,
      payoutCents: null,
      crashPoint: 7.42,
      isDemo: true,
      createdAt: new Date().toISOString(),
    };

    expect(GameBet.parse(view)).toEqual(view);
  });

  /** An open bet: no crash point at all, and the two money fields null. */
  test('an open row satisfies it too, with no crash point', () => {
    const view: GameBetView = {
      id: '7f5f5c4c-7b0e-4a1a-9b0a-2b6c0f8e1d11',
      roundId: 'f1c2b3a4-5d6e-4f70-8a9b-0c1d2e3f4a5b',
      userId: '0a1b2c3d-4e5f-4061-8273-849506a7b8c9',
      betAmountCents: 500,
      status: 'active',
      cashedOutAt: null,
      payoutCents: null,
      isDemo: false,
      createdAt: new Date().toISOString(),
    };

    expect(GameBet.parse(view)).not.toHaveProperty('crashPoint');
  });
});
