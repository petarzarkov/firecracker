import { describe, expect, test } from 'bun:test';
import type { ActiveBetView } from '@firecracker/contracts';
import { mapServerBet } from './useGameSocket';

/**
 * The snapshot the server sends on connect goes through {@link mapServerBet}, and
 * every later frame - `betPlaced`, `betAck`, `betCashedOut` - is keyed on
 * `userId`. If this mapping disagrees about what identity is, the two halves of a
 * bet never meet.
 *
 * That is not hypothetical. It read `userId: bet.username`, under a comment saying
 * the server sent no id, and it was still doing so long after `ActiveBetView`
 * gained one. A player who reloaded mid-round got a second row for their own bet
 * and no cash-out on it. Sharing the type is what surfaced it; this is what keeps
 * it surfaced, because both fields are strings and a compiler cannot tell them
 * apart.
 */
const view = (over: Partial<ActiveBetView> = {}): ActiveBetView => ({
  userId: 'user-1',
  username: 'ada',
  betAmountCents: 500,
  isDemo: true,
  ...over,
});

describe('mapServerBet', () => {
  test('keys the entry on the id, never the display name', () => {
    const entry = mapServerBet(view());
    expect(entry.userId).toBe('user-1');
    expect(entry.username).toBe('ada');
  });

  test('two players sharing a name stay two rows', () => {
    const ada = mapServerBet(view({ userId: 'user-1' }));
    const other = mapServerBet(view({ userId: 'user-2' }));
    expect(ada.userId).not.toBe(other.userId);
  });

  test('a bet with no cash-out is still active', () => {
    const entry = mapServerBet(view());
    expect(entry.status).toBe('ACTIVE');
    expect(entry.cashedOutAt).toBeUndefined();
    expect(entry.payoutCents).toBeUndefined();
  });

  test('a settled bet carries the multiplier and the money', () => {
    const entry = mapServerBet(view({ cashedOutAt: 1.29, payoutCents: 645 }));
    expect(entry.status).toBe('CASHED_OUT');
    expect(entry.cashedOutAt).toBe(1.29);
    expect(entry.payoutCents).toBe(645);
  });

  /**
   * `1.0x` is falsy. Keyed on truthiness this rendered as an open bet, which is a
   * cash-out button offering to close something already closed.
   */
  test('a cash-out at 1.00x still counts as one', () => {
    expect(mapServerBet(view({ cashedOutAt: 1 })).status).toBe('CASHED_OUT');
  });
});
