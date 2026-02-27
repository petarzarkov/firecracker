import { type GamePhase } from '@/store/gameStore';
import { getTipCoords } from './constants';

function glowColorForMultiplier(m: number): { rgb: string; alpha: number } {
  if (m >= 10) return { rgb: '180,0,255', alpha: 0.07 };
  if (m >= 5) return { rgb: '255,140,0', alpha: 0.06 };
  if (m >= 2) return { rgb: '255,200,0', alpha: 0.05 };
  return { rgb: '255,107,0', alpha: 0.04 };
}

export function drawBackgroundGlow(
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
