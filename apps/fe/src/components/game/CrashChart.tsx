import type { Stage, StageSample } from '@firecracker/stage';
import { Box, Text, VStack } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import {
  getLiveMultiplier,
  liveRef,
  multiplierAt,
  takeBoardings,
  takeCashOuts,
  useGameStore,
} from '@/store/gameStore';
import { CountdownDisplay } from './CountdownDisplay';

/** The store's phase, as the stage names it. */
const STAGE_PHASE = {
  IDLE: 'idle',
  WAITING: 'waiting',
  RUNNING: 'running',
  CRASHED: 'crashed',
} as const;

/**
 * The round, drawn by `@firecracker/stage`, with the readouts left in the DOM.
 *
 * Everything drawn - grid, axis labels, curve, starfield, rocket, sparks, embers,
 * boarding players and fireworks - is a PIXI scene in its own workspace. What stays in the DOM is the text
 * a person reads rather than watches: the multiplier, the countdown and the crash
 * result.
 *
 * The axis labels are the stage's on purpose. As DOM nodes they were positioned
 * against a hardcoded reference height while the gridlines were drawn against the
 * canvas's real one, so on a 652px chart the `1x` label sat 43px below its own line -
 * and the axis rescales as a round climbs, so keeping them here would mean
 * re-rendering React mid-round.
 */
export function CrashChart() {
  const boxRef = useRef<HTMLDivElement>(null);
  const multiplierSpanRef = useRef<HTMLSpanElement>(null);

  const phase = useGameStore((state) => state.phase);

  /**
   * The live phase, for the sampler.
   *
   * The stage's ticker runs outside React, so it cannot close over `phase` from
   * a render - it would read whatever the value was when the effect last ran.
   */
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const [crashMultiplier, setCrashMultiplier] = useState(1.0);
  useEffect(() => {
    if (phase === 'CRASHED') setCrashMultiplier(liveRef.multiplier);
  }, [phase]);

  useEffect(() => {
    const container = boxRef.current;
    if (container === null) return;

    let disposed = false;

    /**
     * What the stage asks for, every frame.
     *
     * Reads `liveRef` rather than the store: ticks mutate that ref and never call
     * `set()`, which is what keeps a running round from re-rendering React sixty
     * times a second. Moving to PIXI did not change that contract, it inherited it.
     */
    const sample = (): StageSample => ({
      phase: STAGE_PHASE[phaseRef.current],
      multiplier: getLiveMultiplier(),
      // From the same clock as the multiplier, so the leading edge the stage
      // draws is consistent with the number over it.
      elapsed:
        liveRef.roundStartedAtMs === null
          ? 0
          : Date.now() - liveRef.roundStartedAtMs,
      points: liveRef.chartPoints,
      // The unrounded curve, so the line is limited by pixels rather than by the
      // hundredths the server pays in. See `multiplierAt`.
      curveAt: multiplierAt,
      // From `liveRef` rather than the `Date` in the store, for the same reason
      // everything else here is: the countdown drives the rocket's pre-launch
      // strain on every frame, and the DOM readout beside it re-renders once a
      // second off its own interval.
      waitingLeft:
        liveRef.waitingEndsAtMs === null
          ? null
          : liveRef.waitingEndsAtMs - Date.now(),
    });

    /**
     * Held as a promise, and torn down through it.
     *
     * Cleanup regularly runs while `createStage` is still awaiting a renderer -
     * StrictMode's mount/cleanup/mount guarantees it in development - and a
     * stage nobody kept a reference to would tick forever. Chaining the destroy
     * onto the same promise means the teardown always finds it.
     */
    const pending: Promise<Stage | null> = import('@firecracker/stage')
      .then(({ createStage }) =>
        disposed
          ? null
          : createStage({
              container,
              sample,
              takeCashOuts,
              takeBoardings,
              rocketUrl: '/sprites/firecracker.svg',
              parachutistUrl: '/sprites/parachutist.svg',
              boarderUrl: '/sprites/boarder.svg',
            }),
      )
      .catch((error: unknown) => {
        console.error('[stage] could not start', error);
        return null;
      });

    return () => {
      disposed = true;
      void pending.then((stage) => stage?.destroy());
    };
  }, []);

  /**
   * The multiplier readout, written straight to the DOM node.
   *
   * Its own loop rather than a value the stage hands back, so the text keeps
   * updating at the browser's pace and this component never re-renders for it.
   */
  useEffect(() => {
    let frame: number;
    const paint = () => {
      const node = multiplierSpanRef.current;
      if (node !== null && phaseRef.current === 'RUNNING') {
        node.textContent = `${getLiveMultiplier().toFixed(2)}x`;
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Box
      position="relative"
      flex={1}
      minH="280px"
      borderRadius="lg"
      overflow="hidden"
      bg="#0a0a0a"
      border="1px solid"
      borderColor="gray.700"
    >
      {/* The stage creates its own canvas in here — see `StageOptions`. */}
      <Box ref={boxRef} position="absolute" inset={0} />

      {/*
        The countdown sits high, not in the middle.

        Centred, it printed straight over the rocket - which was tolerable while the
        rocket was a still image behind it and is not now that it hovers, strains and
        has players flying into it. `visual/screens/app-lobby.png` is where that was
        obvious; nothing in the DOM overlaps, so no layout test could have said so.
      */}
      {phase === 'WAITING' && (
        <Box
          position="absolute"
          top="12%"
          left={0}
          right={0}
          textAlign="center"
          pointerEvents="none"
          userSelect="none"
        >
          <CountdownDisplay />
        </Box>
      )}

      <VStack
        position="absolute"
        inset={0}
        justify="center"
        align="center"
        gap={4}
        pointerEvents="none"
        userSelect="none"
      >
        <Box textAlign="center">
          {phase === 'IDLE' && (
            <Text fontSize="3xl" color="gray.600" fontWeight="bold">
              Loading...
            </Text>
          )}

          {phase === 'RUNNING' && (
            <Box
              fontSize={{ base: '5xl', lg: '7xl' }}
              fontWeight="black"
              color="green.400"
              lineHeight="1"
              style={{
                textShadow: '0 0 30px #ff6b00, 0 0 60px #ff6b0088',
                letterSpacing: '-2px',
              }}
            >
              <span ref={multiplierSpanRef}>1.00x</span>
            </Box>
          )}

          {phase === 'CRASHED' && (
            <Box>
              <Text
                fontSize="xl"
                color="red.400"
                fontWeight="bold"
                letterSpacing="widest"
              >
                EXPLODED AT
              </Text>
              <Text
                fontSize={{ base: '4xl', lg: '6xl' }}
                fontWeight="black"
                color="red.300"
                lineHeight="1"
                style={{ textShadow: '0 0 30px #ff4444' }}
              >
                {crashMultiplier.toFixed(2)}x
              </Text>
            </Box>
          )}
        </Box>
      </VStack>
    </Box>
  );
}
