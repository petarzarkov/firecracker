import { type GamePhase, liveRef } from '@/store/gameStore';
import { getTipCoords } from './constants';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

function particleColorRgb(multiplier: number): string {
  if (multiplier >= 10) return '255,36,0'; // Scarlet red
  if (multiplier >= 5) return '255,83,73'; // Orange-red
  if (multiplier >= 2) return '255,140,0'; // Dark orange
  return '255,210,50'; // Golden yellow
}

export function spawnParticles(
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

export function drawParticles(
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

export function updateParticles(
  particles: Particle[],
  W: number,
  H: number,
  phase: GamePhase,
  multiplier: number,
  crashBurstFired: { current: boolean },
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
