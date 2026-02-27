import { liveRef } from '@/store/gameStore';

export const GRID_MULTIPLIERS = [1, 1.5, 2, 3, 5, 10, 20, 50];
export const LOG_MAX = Math.log(50);

// Percentage offsets to find the wick tip relative to the image's exact center.
// The wick is ~16% to the left, and ~39% down from the center of the image asset.
export const WICK_OFFSET_X_PCT = -0.16;
export const WICK_OFFSET_Y_PCT = 0.39;

export const FIREWORK_COLORS = [
  '255,36,0', // scarlet red
  '255,68,68', // bright red
  '255,83,73', // orange-red
  '255,120,0', // pure orange
  '255,140,0', // dark orange
  '255,165,0', // light orange
  '255,210,50', // golden yellow
];

// Fixed canvas padding (px) — keeps consistent margins regardless of canvas size
export const PAD_L = 40;
export const PAD_R = 15;
export const PAD_T = 20;
export const PAD_B = 28;

// For Y-axis HTML label positioning (labels at left: 4px use this for top%)
export function mToYPct(m: number): number {
  const normalized = Math.min(Math.log(Math.max(1.001, m)) / LOG_MAX, 1);
  const REF_H = 360;
  const ch = REF_H - PAD_T - PAD_B;
  const y = PAD_T + ch * (1 - normalized);
  return (y / REF_H) * 100;
}

export function getTipCoords(
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
