import { FIREWORK_COLORS, PAD_L, PAD_R } from './constants';

export interface FireworkRocket {
  x: number;
  y: number;
  targetY: number;
  speed: number;
  delay: number;
  trail: Array<{ x: number; y: number }>;
  exploded: boolean;
  color: string;
}

export interface FireworkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export function spawnFireworks(
  rockets: FireworkRocket[],
  W: number,
  H: number,
) {
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

export function updateAndDrawFireworks(
  ctx: CanvasRenderingContext2D,
  rockets: FireworkRocket[],
  particles: FireworkParticle[],
) {
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
