import type { RoundProof } from '@/store/gameStore';
import { apiFetch } from './api';

/**
 * The provably-fair half of the client.
 *
 * The server has published all of this since the game was written - a commitment
 * before every round and the seeds after every crash, plus a public endpoint that
 * re-serves them with the steps to redo the draw. None of it had reached a screen.
 */

interface VerifyResponse {
  readonly roundId: string;
  readonly serverSeed: string;
  readonly serverSeedHash: string;
  readonly clientSeed: string;
  readonly nonce: number;
  readonly algorithm: string;
  readonly rngSeed: string;
  readonly crashPoint: number;
  readonly howToVerify: readonly string[];
}

/** What a player has to run to redraw the crash point themselves. */
export interface Recipe {
  readonly rngSeed: string;
  readonly steps: readonly string[];
}

export interface FetchedProof {
  readonly proof: RoundProof;
  readonly recipe: Recipe;
}

/**
 * A round's proof from the server.
 *
 * Only needed for rounds this session did not watch crash - after a reload the
 * history is still there and the socket frames that carried the seeds are not.
 */
export const fetchProof = async (roundId: string): Promise<FetchedProof> => {
  const response = await apiFetch(`/api/game/rounds/${roundId}/verify`);
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'That round has not crashed yet, so there is nothing to reveal.'
        : `Could not load the proof (${response.status})`,
    );
  }

  const body = (await response.json()) as VerifyResponse;
  return {
    proof: {
      roundId: body.roundId,
      crashPoint: body.crashPoint,
      serverSeedHash: body.serverSeedHash,
      serverSeed: body.serverSeed,
      clientSeed: body.clientSeed,
      nonce: body.nonce,
      algorithm: body.algorithm,
    },
    recipe: { rngSeed: body.rngSeed, steps: body.howToVerify },
  };
};

/** The generator's seed, exactly as the server builds it. */
export const rngSeedOf = (proof: RoundProof): string =>
  `${proof.serverSeed}:${proof.clientSeed}:${proof.nonce}`;

/**
 * Checks the commitment **in the browser**, with no library and nothing to trust.
 *
 * This is the half of provable fairness that a client can settle on its own: the
 * hash was published before the round ran, so if it matches the seed revealed
 * afterwards, the seed cannot have been chosen once the bets were in. Re-drawing
 * the crash point needs the same PRNG the server used and is documented rather than
 * bundled - a redraw that agreed with us because it ran our code would prove very
 * little anyway.
 */
export const commitmentHolds = async (proof: RoundProof): Promise<boolean> => {
  const bytes = new TextEncoder().encode(proof.serverSeed);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return hex === proof.serverSeedHash.toLowerCase();
};
