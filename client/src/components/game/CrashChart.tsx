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

// Percentage offsets to find the wick tip relative to the image's exact center.
// The wick is ~16% to the left, and ~39% down from the center of the image asset.
const WICK_OFFSET_X_PCT = -0.16;
const WICK_OFFSET_Y_PCT = 0.39;

const FIREWORK_COLORS = [
  '255,68,68', // red
  '255,210,50', // gold
  '68,170,255', // blue
  '100,255,120', // green
  '210,50,255', // purple
  '255,120,0', // orange
  '0,230,220', // cyan
];

// Fixed canvas padding (px) — keeps consistent margins regardless of canvas size
const PAD_L = 40;
const PAD_R = 15;
const PAD_T = 20;
const PAD_B = 28;

// For Y-axis HTML label positioning (labels at left: 4px use this for top%)
function mToYPct(m: number): number {
  const normalized = Math.min(Math.log(Math.max(1.001, m)) / LOG_MAX, 1);
  const REF_H = 360;
  const ch = REF_H - PAD_T - PAD_B;
  const y = PAD_T + ch * (1 - normalized);
  return (y / REF_H) * 100;
}

// ── Canvas coordinate helpers ────────────────────────────────────────────────

function getTipCoords(
  W: number,
  H: number,
  multiplier: number,
): { x: number; y: number } | null {
  if (liveRef.chartPoints.length === 0) return null;
  const cw = W - PAD_L - PAD_R;
  const ch = H - PAD_T - PAD_B;
  const maxE = liveRef.chartPoints[liveRef.chartPoints.length - 1].elapsed;
  const tipX = PAD_L + (maxE / Math.max(maxE, 1)) * cw;
  const tipNorm = Math.min(Math.log(Math.max(1.001, multiplier)) / LOG_MAX, 1);
  const tipY = PAD_T + ch * (1 - tipNorm);
  return { x: tipX, y: tipY };
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

// ── Background glow ──────────────────────────────────────────────────────────

function glowColorForMultiplier(m: number): { rgb: string; alpha: number } {
  if (m >= 10) return { rgb: '180,0,255', alpha: 0.07 };
  if (m >= 5) return { rgb: '255,140,0', alpha: 0.06 };
  if (m >= 2) return { rgb: '255,200,0', alpha: 0.05 };
  return { rgb: '76,175,80', alpha: 0.04 };
}

function drawBackgroundGlow(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  phase: GamePhase,
  multiplier: number,
  crashFlash: number,
) {
  if (crashFlash > 0) {
    const flashAlpha = (crashFlash / 60) * 0.14;
    const grad = ctx.createRadialGradient(
      W / 2,
      H / 2,
      0,
      W / 2,
      H / 2,
      W * 0.5,
    );
    grad.addColorStop(0, `rgba(255,68,68,${flashAlpha.toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,68,68,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    return;
  }

  if (phase !== 'RUNNING') return;

  const tip = getTipCoords(W, H, multiplier);
  if (!tip) return;

  const { rgb, alpha } = glowColorForMultiplier(multiplier);
  const radius = W * 0.32;
  const grad = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, radius);
  grad.addColorStop(0, `rgba(${rgb},${alpha})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

// ── Wick animations ──────────────────────────────────────────────────────────

interface WickSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

const WICK_SPARK_COLORS = [
  '255,200,50',
  '255,140,0',
  '255,255,180',
  '255,90,0',
];

function drawWickGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const outer = ctx.createRadialGradient(cx, cy, 2, cx, cy, 18);
  outer.addColorStop(0, 'rgba(255,160,30,0.55)');
  outer.addColorStop(0.4, 'rgba(255,100,0,0.25)');
  outer.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fill();

  const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, 6);
  inner.addColorStop(0, 'rgba(255,255,220,0.95)');
  inner.addColorStop(0.5, 'rgba(255,200,60,0.7)');
  inner.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
}

function spawnWickSparks(sparks: WickSpark[], cx: number, cy: number) {
  const count = Math.floor(Math.random() * 3) + 2;
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
    const speed = Math.random() * 1.7 + 0.8;
    const maxLife = Math.floor(Math.random() * 15) + 10;
    sparks.push({
      x: cx + (Math.random() - 0.5) * 5,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: maxLife,
      maxLife,
      size: Math.random() * 1.2 + 0.4,
      color:
        WICK_SPARK_COLORS[Math.floor(Math.random() * WICK_SPARK_COLORS.length)],
    });
  }
  if (sparks.length > 80) sparks.splice(0, sparks.length - 80);
}

function drawWickSparks(ctx: CanvasRenderingContext2D, sparks: WickSpark[]) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx;
    s.y += s.vy;
    s.vy -= 0.06; // float upward
    s.vx *= 0.93; // air resistance
    s.life -= 1;
    if (s.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }
    const t = s.life / s.maxLife;
    const alpha = t * 0.9;
    const radius = Math.max(0.3, t * s.size * 2.2);
    ctx.beginPath();
    ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${s.color},${alpha.toFixed(2)})`;
    ctx.fill();
  }
}

// ── Firework system ───────────────────────────────────────────────────────────

interface FireworkRocket {
  x: number;
  y: number;
  targetY: number;
  speed: number;
  delay: number;
  trail: Array<{ x: number; y: number }>;
  exploded: boolean;
  color: string;
}

interface FireworkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

function spawnFireworks(rockets: FireworkRocket[], W: number, H: number) {
  const count = 6;
  for (let i = 0; i < count; i++) {
    rockets.push({
      x: PAD_L + Math.random() * (W - PAD_L - PAD_R),
      y: H,
      targetY: H * 0.15 + Math.random() * H * 0.35,
      speed: 8 + Math.random() * 6,
      delay: i * 5,
      trail: [],
      exploded: false,
      color:
        FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
    });
  }
}

function updateAndDrawFireworks(
  ctx: CanvasRenderingContext2D,
  rockets: FireworkRocket[],
  particles: FireworkParticle[],
) {
  // Rockets
  for (const rocket of rockets) {
    if (rocket.exploded) continue;
    if (rocket.delay > 0) {
      rocket.delay -= 1;
      continue;
    }
    rocket.trail.push({ x: rocket.x, y: rocket.y });
    if (rocket.trail.length > 8) rocket.trail.shift();
    rocket.y -= rocket.speed;

    for (let t = 0; t < rocket.trail.length; t++) {
      const alpha = ((t + 1) / rocket.trail.length) * 0.55;
      const r = 1 + (t / rocket.trail.length) * 1.5;
      ctx.beginPath();
      ctx.arc(rocket.trail[t].x, rocket.trail[t].y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rocket.color},${alpha.toFixed(2)})`;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(rocket.x, rocket.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rocket.color},0.95)`;
    ctx.fill();

    if (rocket.y <= rocket.targetY) {
      rocket.exploded = true;
      const burstCount = 45 + Math.floor(Math.random() * 20);
      for (let i = 0; i < burstCount; i++) {
        const angle =
          (Math.PI * 2 * i) / burstCount + (Math.random() - 0.5) * 0.3;
        const speed = 2 + Math.random() * 4;
        const maxLife = 45 + Math.floor(Math.random() * 20);
        particles.push({
          x: rocket.x,
          y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: maxLife,
          maxLife,
          size: Math.random() * 1.5 + 0.8,
          color: rocket.color,
        });
      }
    }
  }

  // Burst particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12; // gravity
    p.vx *= 0.97; // drag
    p.life -= 1;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    const t = p.life / p.maxLife;
    const alpha = t * 0.88;
    const radius = Math.max(0.3, t * p.size * 2.5);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.color},${alpha.toFixed(2)})`;
    ctx.fill();
  }
}

// ── Particle system ──────────────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

function particleColorRgb(multiplier: number): string {
  if (multiplier >= 10) return '180,0,255';
  if (multiplier >= 5) return '255,140,0';
  if (multiplier >= 2) return '255,200,0';
  return '76,175,80';
}

function spawnParticles(
  particles: Particle[],
  tipX: number,
  tipY: number,
  multiplier: number,
  burst: boolean,
) {
  const count = burst ? 40 : Math.min(Math.ceil(multiplier / 3), 6);
  for (let i = 0; i < count; i++) {
    const angle = burst
      ? Math.random() * Math.PI * 2
      : -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
    const speed = burst ? Math.random() * 4 + 1 : Math.random() * 2 + 0.5;
    const maxLife = burst ? Math.random() * 30 + 20 : 25;
    particles.push({
      x: tipX + (Math.random() - 0.5) * 4,
      y: tipY + (Math.random() - 0.5) * 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (burst ? 0 : 0.5),
      life: maxLife,
      maxLife,
      size: Math.random() * 1.5 + 0.5,
    });
  }
  if (particles.length > 300) particles.splice(0, particles.length - 300);
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  multiplier: number,
  isCrashed: boolean,
) {
  const color = isCrashed ? '255,68,68' : particleColorRgb(multiplier);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.08;
    p.life -= 1;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    const alpha = (p.life / p.maxLife) * 0.85;
    const size = Math.max(0.3, (p.life / p.maxLife) * p.size * 2.5);
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color},${alpha.toFixed(2)})`;
    ctx.fill();
  }
}

function updateParticles(
  particles: Particle[],
  W: number,
  H: number,
  phase: GamePhase,
  multiplier: number,
  crashBurstFired: React.MutableRefObject<boolean>,
) {
  if (phase === 'RUNNING') {
    const tip = getTipCoords(W, H, multiplier);
    if (tip) spawnParticles(particles, tip.x, tip.y, multiplier, false);
  }
  if (phase === 'CRASHED' && !crashBurstFired.current) {
    const tip = getTipCoords(W, H, liveRef.multiplier);
    if (tip) {
      spawnParticles(particles, tip.x, tip.y, liveRef.multiplier, true);
      crashBurstFired.current = true;
    }
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

  // Curve + end-dot
  ctx.save();
  ctx.shadowBlur = 12;
  ctx.shadowColor = color;
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
  ctx.beginPath();
  ctx.arc(lx, ly, 7, 0, Math.PI * 2);
  ctx.fillStyle = `${color}4D`;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lx, ly, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// ── Phase effects orchestrator ───────────────────────────────────────────────

function drawPhaseEffects(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  phase: GamePhase,
  wickSparks: WickSpark[],
  rockets: FireworkRocket[],
  fwParticles: FireworkParticle[],
  fireworksFiredRef: React.MutableRefObject<boolean>,
  wickX: number,
  wickY: number,
) {
  if (phase === 'WAITING') {
    drawWickGlow(ctx, wickX, wickY);
  }
  if (phase === 'RUNNING') {
    spawnWickSparks(wickSparks, wickX, wickY);
    drawWickSparks(ctx, wickSparks);
  }
  if (phase === 'CRASHED' && !fireworksFiredRef.current) {
    spawnFireworks(rockets, W, H);
    fireworksFiredRef.current = true;
  }
  if (rockets.length > 0 || fwParticles.length > 0) {
    updateAndDrawFireworks(ctx, rockets, fwParticles);
  }
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
  // NEW: Ref to track the exact screen position of the rocket image
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

  const phase = useGameStore(state => state.phase);
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

      // --- Calculate dynamic wick coordinates ---
      let wickX = W / 2;
      let wickY = H / 2;

      // Ensure the spark precisely follows the image, even while pulsing
      if (imageRef.current) {
        const imgRect = imageRef.current.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();

        // Find the absolute center of the image element relative to the canvas
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
              ref={imageRef} // <-- Attached the ref here
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
