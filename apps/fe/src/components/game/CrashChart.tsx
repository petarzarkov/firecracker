import { Box, Text, VStack } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import {
  type GamePhase,
  getLiveMultiplier,
  liveRef,
  useGameStore,
} from '@/store/gameStore';
import { drawBackgroundGlow } from './crash-chart/background';
import { CountdownDisplay } from './crash-chart/CountdownDisplay';
import { drawChart } from './crash-chart/chart';
import {
  GRID_MULTIPLIERS,
  mToYPct,
  WICK_OFFSET_X_PCT,
  WICK_OFFSET_Y_PCT,
} from './crash-chart/constants';
import {
  type FireworkParticle,
  type FireworkRocket,
} from './crash-chart/fireworks';
import {
  drawParticles,
  type Particle,
  updateParticles,
} from './crash-chart/particles';
import { drawPhaseEffects } from './crash-chart/phase-effects';
import { drawStars, initStars, type Star } from './crash-chart/stars';
import { type WickSpark } from './crash-chart/wick';

export function CrashChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const starsRef = useRef<Star[]>(initStars());
  const particlesRef = useRef<Particle[]>([]);
  const crashBurstFiredRef = useRef(false);
  const crashFlashRef = useRef(0);
  const multiplierSpanRef = useRef<HTMLElement>(null);
  const wickSparksRef = useRef<WickSpark[]>([]);
  const fireworkRocketsRef = useRef<FireworkRocket[]>([]);
  const fireworkParticlesRef = useRef<FireworkParticle[]>([]);
  const fireworksFiredRef = useRef(false);

  const phase = useGameStore((state) => state.phase);
  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (phase !== 'CRASHED') {
      crashBurstFiredRef.current = false;
      fireworksFiredRef.current = false;
      fireworkRocketsRef.current = [];
      fireworkParticlesRef.current = [];
    }
    if (phase !== 'RUNNING') {
      wickSparksRef.current = [];
    }
  }, [phase]);

  const [crashMultiplier, setCrashMultiplier] = useState(1.0);
  useEffect(() => {
    if (phase === 'CRASHED') {
      setCrashMultiplier(liveRef.multiplier);
      crashFlashRef.current = 60;
    }
  }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animId: number;

    const draw = () => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;

      if (W === 0 || H === 0) {
        animId = requestAnimationFrame(draw);
        return;
      }

      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animId = requestAnimationFrame(draw);
        return;
      }

      const currentPhase = phaseRef.current;
      const currentMultiplier = getLiveMultiplier();

      ctx.clearRect(0, 0, W, H);

      drawBackgroundGlow(
        ctx,
        W,
        H,
        currentPhase,
        currentMultiplier,
        crashFlashRef.current,
      );
      if (crashFlashRef.current > 0) crashFlashRef.current -= 1;

      drawStars(ctx, W, H, starsRef.current, currentPhase);
      drawChart(ctx, W, H, currentPhase);

      let wickX = W / 2;
      let wickY = H / 2;

      if (imageRef.current) {
        const imgRect = imageRef.current.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const imgCenterX = imgRect.left - canvasRect.left + imgRect.width / 2;
        const imgCenterY = imgRect.top - canvasRect.top + imgRect.height / 2;
        wickX = imgCenterX + imgRect.width * WICK_OFFSET_X_PCT;
        wickY = imgCenterY + imgRect.height * WICK_OFFSET_Y_PCT;
      }

      drawPhaseEffects(
        ctx,
        W,
        H,
        currentPhase,
        wickSparksRef.current,
        fireworkRocketsRef.current,
        fireworkParticlesRef.current,
        fireworksFiredRef,
        wickX,
        wickY,
      );

      updateParticles(
        particlesRef.current,
        W,
        H,
        currentPhase,
        currentMultiplier,
        crashBurstFiredRef,
      );
      if (particlesRef.current.length > 0) {
        drawParticles(
          ctx,
          particlesRef.current,
          currentMultiplier,
          currentPhase === 'CRASHED',
        );
      }

      if (multiplierSpanRef.current && currentPhase === 'RUNNING') {
        multiplierSpanRef.current.textContent = `${currentMultiplier.toFixed(2)}x`;
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
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

      {GRID_MULTIPLIERS.map((m) => {
        const topPct = mToYPct(m);
        if (topPct < 0 || topPct > 100) return null;
        return (
          <Box
            key={m}
            position="absolute"
            left="4px"
            top={`${topPct}%`}
            transform="translateY(-50%)"
            pointerEvents="none"
            userSelect="none"
          >
            <Text
              fontSize="11px"
              color="rgba(255,255,255,0.55)"
              fontFamily="monospace"
              fontWeight="medium"
              lineHeight={1}
              whiteSpace="nowrap"
            >
              {m}x
            </Text>
          </Box>
        );
      })}

      <style>{`
        @keyframes fc-pulse {
          from { transform: scale(1); }
          to   { transform: scale(1.14); }
        }
      `}</style>

      <VStack
        position="absolute"
        inset={0}
        justify="center"
        align="center"
        gap={4}
        pointerEvents="none"
        userSelect="none"
      >
        {(phase === 'WAITING' || phase === 'RUNNING') && (
          <Box
            style={{
              animation:
                phase === 'RUNNING'
                  ? 'fc-pulse 0.6s ease-in-out infinite alternate'
                  : 'none',
            }}
          >
            <img
              ref={imageRef}
              src="/png/android-chrome-192x192.png"
              alt="firecracker"
              width={phase === 'RUNNING' ? 120 : 90}
              height={phase === 'RUNNING' ? 120 : 90}
              style={{
                opacity: phase === 'WAITING' ? 0.4 : 1,
                filter:
                  phase === 'RUNNING'
                    ? 'drop-shadow(0 0 20px #4CAF50)'
                    : 'none',
                transition: 'width 0.3s, height 0.3s, opacity 0.3s',
              }}
            />
          </Box>
        )}
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
                textShadow: '0 0 30px #4CAF50, 0 0 60px #4CAF5088',
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
