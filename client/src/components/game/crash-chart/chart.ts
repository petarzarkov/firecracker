import { type GamePhase, liveRef } from '@/store/gameStore';
import {
  GRID_MULTIPLIERS,
  LOG_MAX,
  PAD_B,
  PAD_L,
  PAD_R,
  PAD_T,
} from './constants';

export function drawChart(
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

  const color = phase === 'CRASHED' ? '#ff4444' : '#ff9500';
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
