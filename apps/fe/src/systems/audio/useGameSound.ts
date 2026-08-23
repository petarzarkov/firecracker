import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getLiveMultiplier, useGameStore } from '@/store/gameStore';
import { createAudio, type GameAudio } from './audio';

/**
 * Whether the game makes any noise, remembered between visits.
 *
 * **Off by default**, and that is not a placeholder: a browser will not start an
 * audio context outside a user gesture anyway, and a game that greets a stranger
 * with sound gets its tab closed.
 */
export const useSoundStore = create<{
  on: boolean;
  toggle: () => void;
}>()(
  persist(
    (set) => ({
      on: false,
      toggle: () => set((state) => ({ on: !state.on })),
    }),
    { name: 'firecracker-sound' },
  ),
);

/**
 * Wires the round to the three cues.
 *
 * Mounted once, in `Game`. The climbing pitch is driven from a frame loop reading
 * `liveRef`, the same contract everything else on this clock keeps: the multiplier
 * changes ten times a second and no part of that may cause a React render.
 */
export function useGameSound(): void {
  const on = useSoundStore((state) => state.on);
  const phase = useGameStore((state) => state.phase);
  const myBetStatus = useGameStore((state) => state.myBet?.status);

  const audio = useRef<GameAudio | null>(null);
  if (audio.current === null) audio.current = createAudio();

  useEffect(() => {
    const sound = audio.current;
    return () => sound?.dispose();
  }, []);

  useEffect(() => {
    audio.current?.setEnabled(on);
  }, [on]);

  useEffect(() => {
    const sound = audio.current;
    if (sound === null || !on) return;

    if (phase === 'RUNNING') {
      sound.startClimb();
      let frame: number;
      const follow = () => {
        sound.updateClimb(getLiveMultiplier());
        frame = requestAnimationFrame(follow);
      };
      frame = requestAnimationFrame(follow);
      return () => {
        cancelAnimationFrame(frame);
        sound.stopClimb();
      };
    }

    if (phase === 'CRASHED') sound.crash();
    return;
  }, [phase, on]);

  /**
   * Your own cash-out, not everyone's. The lobby settles a dozen bets a round and
   * a chime for each would be a slot machine.
   */
  useEffect(() => {
    if (on && myBetStatus === 'CASHED_OUT') audio.current?.cashOut();
  }, [myBetStatus, on]);
}
