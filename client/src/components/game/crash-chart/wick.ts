export interface WickSpark {
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

export function drawWickGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
) {
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

export function spawnWickSparks(sparks: WickSpark[], cx: number, cy: number) {
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

export function drawWickSparks(
  ctx: CanvasRenderingContext2D,
  sparks: WickSpark[],
) {
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
