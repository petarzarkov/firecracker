import { AppEvent } from '@dunx/core';

/**
 * A tick found bets whose auto-cashout multiplier the round has reached.
 *
 * An event rather than a callback the gateway registers, and the reason is the
 * dependency edge: sweeping pays a wallet, and the clock's only game dependency is
 * `GameRoundRepository`. `CrashEngineService` publishing this names no subscriber,
 * so the edge stays where it was while the indirection loses its wiring step.
 *
 * The wiring step was also a gap. A registered callback was armed from the
 * gateway's `onInit`, which runs after boot recovery has already resumed a
 * mid-flight round, so the first ticks of that round swept nothing. `@OnEvent`
 * subscriptions are wired in `onBeforeInit`, before any `onInit` runs.
 */
export class AutoCashOutReached extends AppEvent {
  constructor(
    readonly roundId: string,
    readonly multiplierX100: number,
  ) {
    super();
  }
}
