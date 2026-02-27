import { type GamePhase } from '@/store/gameStore';

const STAR_COUNT = 150;

export interface Star {
  x: number;
  y: number;
  z: number;
}

export function initStars(): Star[] {
  return Array.from({ length: STAR_COUNT }, () => ({
    x: (Math.random() - 0.5) * 2000,
    y: (Math.random() - 0.5) * 2000,
    z: Math.random() * 1000,
  }));
}

export function drawStars(
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
