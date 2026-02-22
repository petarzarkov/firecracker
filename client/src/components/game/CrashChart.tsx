import { Box, Text, VStack } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import {
  type GamePhase,
  getLiveMultiplier,
  liveRef,
  useGameStore,
} from '@/store/gameStore';

// ── Chart constants ─────────────────────────────────────────────────────────

const GRID_MULTIPLIERS = [1, 1.5, 2, 3, 5, 10, 20, 50];
const LOG_MAX = Math.log(50);
const STAR_COUNT = 150;

// Fixed canvas padding (px) — keeps consistent margins regardless of canvas size
const PAD_L = 40;
const PAD_R = 15;
const PAD_T = 20;
const PAD_B = 28;

// For Y-axis HTML label positioning (labels at left: 4px use this for top%)
// Labels are positioned relative to the chart area. Using the same formula as mToY.
function mToYPct(m: number): number {
  const normalized = Math.min(Math.log(Math.max(1.001, m)) / LOG_MAX, 1);
  // In canvas: y = PAD_T + CH * (1 - normalized). As % of total canvas height:
  // We expose this as a percentage so HTML labels align regardless of canvas height.
  // We'll compute the fraction of the canvas height (0..1) this represents.
  // Since PAD_T and PAD_B are fixed pixels, we can't express this as a pure %
  // without knowing canvas height. Use a known reference height (360px default).
  const REF_H = 360;
  const ch = REF_H - PAD_T - PAD_B;
  const y = PAD_T + ch * (1 - normalized);
  return (y / REF_H) * 100;
}

// ── Star field ─────────────────────────────────────────────────────────────

interface Star {
  x: number;
  y: number;
  z: number;
}

function initStars(): Star[] {
  return Array.from({ length: STAR_COUNT }, () => ({
    x: (Math.random() - 0.5) * 2000,
    y: (Math.random() - 0.5) * 2000,
    z: Math.random() * 1000,
  }));
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  stars: Star[],
  phase: GamePhase,
) {
  const speed =
    phase === 'RUNNING'
      ? 9
      : phase === 'WAITING'
        ? 1.5
        : phase === 'CRASHED'
          ? 0.3
          : 0.5;

  for (const star of stars) {
    star.z -= speed;
    if (star.z <= 1) {
      star.x = (Math.random() - 0.5) * 2000;
      star.y = (Math.random() - 0.5) * 2000;
      star.z = 1000;
    }
    const px = (star.x / star.z) * (W / 2) + W / 2;
    const py = (star.y / star.z) * (H / 2) + H / 2;
    if (px < 0 || px > W || py < 0 || py > H) continue;
    const t = 1 - star.z / 1000;
    const size = Math.max(0.3, t * 2.5);
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${(t * 0.85).toFixed(2)})`;
    ctx.fill();
  }
}

// ── Chart drawing ───────────────────────────────────────────────────────────

function drawChart(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  phase: GamePhase,
) {
  const cw = W - PAD_L - PAD_R;
  const ch = H - PAD_T - PAD_B;

  const mY = (m: number): number => {
    const norm = Math.min(Math.log(Math.max(1.001, m)) / LOG_MAX, 1);
    return PAD_T + ch * (1 - norm);
  };
  const eX = (e: number, maxE: number): number =>
    PAD_L + (e / Math.max(maxE, 1)) * cw;

  const color = phase === 'CRASHED' ? '#ff4444' : '#4CAF50';
  const { chartPoints } = liveRef;

  // Grid lines
  ctx.lineWidth = 1;
  for (const m of GRID_MULTIPLIERS) {
    const y = mY(m);
    if (y < PAD_T || y > PAD_T + ch) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(W - PAD_R, y);
    ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(PAD_L, PAD_T);
  ctx.lineTo(PAD_L, PAD_T + ch);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(PAD_L, PAD_T + ch);
  ctx.lineTo(W - PAD_R, PAD_T + ch);
  ctx.stroke();

  if (chartPoints.length < 2) return;

  const maxE = chartPoints[chartPoints.length - 1].elapsed;
  const lx = eX(chartPoints[chartPoints.length - 1].elapsed, maxE);
  const ly = mY(chartPoints[chartPoints.length - 1].multiplier);

  // Fill gradient
  const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + ch);
  grad.addColorStop(0, `${color}${phase === 'CRASHED' ? '33' : '40'}`);
  grad.addColorStop(1, `${color}00`);

  ctx.beginPath();
  for (let i = 0; i < chartPoints.length; i++) {
    const x = eX(chartPoints[i].elapsed, maxE);
    const y = mY(chartPoints[i].multiplier);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(lx, PAD_T + ch);
  ctx.lineTo(PAD_L, PAD_T + ch);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Curve
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < chartPoints.length; i++) {
    const x = eX(chartPoints[i].elapsed, maxE);
    const y = mY(chartPoints[i].multiplier);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // End dot
  ctx.beginPath();
  ctx.arc(lx, ly, 7, 0, Math.PI * 2);
  ctx.fillStyle = `${color}4D`;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lx, ly, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// ── Countdown overlay ───────────────────────────────────────────────────────

function CountdownDisplay() {
  const waitingEndsAt = useGameStore(state => state.waitingEndsAt);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!waitingEndsAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((waitingEndsAt.getTime() - Date.now()) / 1000),
      );
      setSecs(remaining);
    }, 100);
    return () => clearInterval(interval);
  }, [waitingEndsAt]);

  return (
    <Text fontSize="2xl" color="gray.400" fontWeight="semibold">
      {secs > 0 ? `Starting in ${secs}s` : 'Starting...'}
    </Text>
  );
}

// ── CrashChart ──────────────────────────────────────────────────────────────

export function CrashChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[]>(initStars());
  // Span updated via textContent in the RAF loop — no React re-renders on tick
  const multiplierSpanRef = useRef<HTMLElement>(null);

  // Subscribe ONLY to phase — ticks no longer trigger re-renders
  const phase = useGameStore(state => state.phase);
  // Keep a ref in sync so the RAF closure always sees the latest phase
  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;

  // On crash, capture the crash multiplier for the static overlay
  const [crashMultiplier, setCrashMultiplier] = useState(1.0);
  useEffect(() => {
    if (phase === 'CRASHED') {
      setCrashMultiplier(liveRef.multiplier);
    }
  }, [phase]);

  // Single RAF loop: stars + chart + multiplier text update.
  // No React state is read here — everything comes from refs and liveRef.
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

      // Resize backing store to match CSS size (handles window resize & DPR)
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

      ctx.clearRect(0, 0, W, H);
      drawStars(ctx, W, H, starsRef.current, currentPhase);
      drawChart(ctx, W, H, currentPhase);

      // Update the running multiplier text directly without React re-render
      if (multiplierSpanRef.current && currentPhase === 'RUNNING') {
        multiplierSpanRef.current.textContent = `${getLiveMultiplier().toFixed(2)}x`;
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []); // No deps — RAF runs continuously, reads from refs

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
      {/* Single canvas: stars + chart curve (no React re-renders for ticks) */}
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

      {/* Y-axis labels — HTML overlay, fixed font size (doesn't stretch) */}
      {GRID_MULTIPLIERS.map(m => {
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
              fontSize="10px"
              color="rgba(255,255,255,0.35)"
              fontFamily="monospace"
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

      {/* Center overlay — re-renders ONLY when phase changes, not on ticks */}
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

          {/* Running multiplier — inner span updated via textContent in RAF, no re-renders */}
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

          {/* Crashed — static, captured once when phase changes */}
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
