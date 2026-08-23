/**
 * The game's three sounds, synthesised.
 *
 * A crash game without a climbing tone and a bang is missing half its feedback -
 * the multiplier is the tension and it was silent. Synthesised with WebAudio rather
 * than shipped as files: three cues is not worth an asset pipeline, a licence
 * question and a hundred kilobytes on a bundle that already carries a renderer, and
 * an oscillator whose pitch *is* the multiplier tracks the round exactly rather than
 * approximately.
 *
 * **Off until asked for.** Nothing here builds an `AudioContext` until
 * {@link GameAudio.setEnabled} is called, which happens from a click - browsers
 * refuse to start one any other way, and a game that makes noise at a stranger on
 * arrival deserves the tab it gets closed in.
 */

/** Where the climb sits: a fifth below A3 at 1x, up two octaves by 10x. */
const CLIMB_BASE_HZ = 146.8;
const CLIMB_TOP_HZ = 587.3;
const CLIMB_GAIN = 0.05;

/** How quickly the tone follows the number, in seconds. Smooth, not laggy. */
const GLIDE = 0.08;

export interface GameAudio {
  readonly enabled: boolean;
  /** Turning it on has to happen inside a user gesture. */
  setEnabled(on: boolean): void;
  /** The round has launched. */
  startClimb(): void;
  /** Called on the render clock, not on ticks - the pitch is the live multiplier. */
  updateClimb(multiplier: number): void;
  stopClimb(): void;
  crash(): void;
  cashOut(): void;
  dispose(): void;
}

export const createAudio = (): GameAudio => {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let enabled = false;

  let climb: { osc: OscillatorNode; gain: GainNode } | null = null;

  /** The context, made on first use. Returns `null` when sound is off. */
  const live = (): AudioContext | null => {
    if (!enabled) return null;
    if (context === null) {
      const Ctor =
        globalThis.AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor === undefined) return null;
      context = new Ctor();
      master = context.createGain();
      master.gain.value = 0.9;
      master.connect(context.destination);
    }
    // A context can be suspended by the browser between rounds.
    if (context.state === 'suspended') void context.resume();
    return context;
  };

  const stopClimb = (): void => {
    if (climb === null || context === null) return;
    const { osc, gain } = climb;
    climb = null;
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setTargetAtTime(0, context.currentTime, 0.04);
    osc.stop(context.currentTime + 0.3);
  };

  return {
    get enabled() {
      return enabled;
    },

    setEnabled(on): void {
      enabled = on;
      if (!on) {
        stopClimb();
        void context?.suspend();
        return;
      }
      live();
    },

    startClimb(): void {
      const ctx = live();
      if (ctx === null || master === null || climb !== null) return;

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = CLIMB_BASE_HZ;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      // Faded in rather than switched on: a square-edged start is a click.
      gain.gain.setTargetAtTime(CLIMB_GAIN, ctx.currentTime, 0.08);

      osc.connect(gain).connect(master);
      osc.start();
      climb = { osc, gain };
    },

    updateClimb(multiplier): void {
      if (climb === null || context === null) return;
      /**
       * Logarithmic, like the axis. A linear map would spend the whole audible
       * range on the first three multiples and then have nothing left to say about
       * the round that actually got somewhere.
       */
      const heat = Math.min(
        1,
        Math.log(Math.max(1, multiplier)) / Math.log(10),
      );
      const hz = CLIMB_BASE_HZ + (CLIMB_TOP_HZ - CLIMB_BASE_HZ) * heat;
      climb.osc.frequency.setTargetAtTime(hz, context.currentTime, GLIDE);
    },

    stopClimb,

    crash(): void {
      const ctx = live();
      if (ctx === null || master === null) return;
      stopClimb();

      const now = ctx.currentTime;

      // The bang: a short burst of noise, opened wide and closed fast.
      const length = Math.floor(ctx.sampleRate * 0.45);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, now);
      filter.frequency.exponentialRampToValueAtTime(180, now + 0.4);

      const bang = ctx.createGain();
      bang.gain.setValueAtTime(0.5, now);
      bang.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      noise.connect(filter).connect(bang).connect(master);
      noise.start(now);

      // And the thump under it, which is what makes it a body rather than a hiss.
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(120, now);
      thump.frequency.exponentialRampToValueAtTime(38, now + 0.3);
      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(0.5, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      thump.connect(thumpGain).connect(master);
      thump.start(now);
      thump.stop(now + 0.36);
    },

    cashOut(): void {
      const ctx = live();
      if (ctx === null || master === null) return;
      const now = ctx.currentTime;

      // Two notes up, briskly. It has to land before the eye leaves the button.
      for (const [at, hz] of [
        [0, 784],
        [0.09, 1175],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = hz;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now + at);
        gain.gain.linearRampToValueAtTime(0.22, now + at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.22);
        osc.connect(gain).connect(master);
        osc.start(now + at);
        osc.stop(now + at + 0.25);
      }
    },

    dispose(): void {
      stopClimb();
      void context?.close();
      context = null;
      master = null;
      enabled = false;
    },
  };
};
