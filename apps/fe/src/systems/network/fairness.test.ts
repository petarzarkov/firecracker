import { describe, expect, test } from 'bun:test';
import type { RoundProof } from '@/store/gameStore';
import { commitmentHolds, rngSeedOf } from './fairness';

/**
 * The commitment check is the one half of provable fairness a client can settle by
 * itself, so it has to be right in the direction that matters: a mismatch must read
 * as a mismatch. A check that answers "fine" to everything is worse than no check,
 * because it puts a green tick next to a result nobody verified.
 */
const sha256 = async (text: string): Promise<string> =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const SERVER_SEED = 'a-server-seed-nobody-has-seen-yet';

const proof = async (over: Partial<RoundProof> = {}): Promise<RoundProof> => ({
  roundId: 'round-1',
  crashPoint: 2.41,
  serverSeed: SERVER_SEED,
  serverSeedHash: await sha256(SERVER_SEED),
  clientSeed: 'firecracker',
  nonce: 42,
  algorithm: 'pcg64',
  ...over,
});

describe('the commitment', () => {
  test('holds when the revealed seed hashes to what was published', async () => {
    expect(await commitmentHolds(await proof())).toBe(true);
  });

  test('fails when the seed is not the one committed to', async () => {
    const swapped = await proof({ serverSeed: 'a-seed-chosen-after-the-bets' });
    expect(await commitmentHolds(swapped)).toBe(false);
  });

  test('fails when the commitment itself is altered', async () => {
    const tampered = await proof({
      serverSeedHash: await sha256('something else'),
    });
    expect(await commitmentHolds(tampered)).toBe(false);
  });

  /** The server sends lowercase, but a hash is a hash. */
  test('does not care about the case the hash arrives in', async () => {
    const shouted = await proof();
    expect(
      await commitmentHolds({
        ...shouted,
        serverSeedHash: shouted.serverSeedHash.toUpperCase(),
      }),
    ).toBe(true);
  });

  test('is not fooled by an empty hash', async () => {
    expect(await commitmentHolds(await proof({ serverSeedHash: '' }))).toBe(
      false,
    );
  });
});

describe('the generator seed', () => {
  /**
   * `${serverSeed}:${clientSeed}:${nonce}`, exactly - the order and the separators
   * are the difference between reproducing the draw and not.
   */
  test('is the three inputs in the order the server combines them', async () => {
    expect(rngSeedOf(await proof())).toBe(`${SERVER_SEED}:firecracker:42`);
  });
});
