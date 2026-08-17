import type { Stage, StageSample } from '@firecracker/stage';
import { Box, Text, VStack } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { getLiveMultiplier, liveRef, useGameStore } from '@/store/gameStore';
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
 * ## What moved, and what did not
 *
 * The canvas half - grid, axis labels, curve, starfield, rocket, sparks, embers
 * and fireworks - is now a PIXI scene in its own workspace. What stayed here is
 * the text: the multiplier, the countdown and the crash result. Those are worth
 * keeping in the DOM because they are the parts a person reads rather than
 * watches, and the theme already styles them.
 *
 * The axis labels went the other way for the opposite reason. They were DOM nodes
 * positioned against a hardcoded 360px reference height while the gridlines were
 * drawn against the canvas's real one, so on a 652px chart the `1x` label sat 43px
 * below its own line. Inside the stage there is one scale, so they cannot
 * disagree - and they have to be there now anyway, since the axis rescales as a
 * round climbs and DOM labels would mean re-rendering React mid-round.
 */
export function CrashChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    const canvas = canvasRef.current;
    if (canvas === null) return;

    let stage: Stage | null = null;
    let live = true;

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
      points: liveRef.chartPoints,
    });

    void import('@firecracker/stage')
      .then(({ createStage }) =>
        createStage({
          canvas,
          sample,
          rocketUrl: '/png/android-chrome-192x192.png',
        }),
      )
      .then((created) => {
        // The effect can be torn down before PIXI finishes initialising - React
        // StrictMode guarantees it in development - and a stage nobody holds a
        // reference to would tick forever.
        if (!live) {
          created.destroy();
          return;
        }
        stage = created;
      })
      .catch((error: unknown) => {
        console.error('[stage] could not start', error);
      });

    return () => {
      live = false;
      stage?.destroy();
      stage = null;
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
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />

      <VStack
        position="absolute"
        inset={0}
        justify="center"
        align="center"
        gap={4}
        pointerEvents="none"
        userSelect="none"
      >
        {phase === 'CRASHED' && (
          <Text fontSize="100px" lineHeight="1">
            💥
          </Text>
        )}

        <Box textAlign="center">
          {phase === 'IDLE' && (
            <Text fontSize="3xl" color="gray.600" fontWeight="bold">
              Loading...
            </Text>
          )}
          {phase === 'WAITING' && <CountdownDisplay />}

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
