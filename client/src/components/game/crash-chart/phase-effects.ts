import { type GamePhase } from '@/store/gameStore';
import {
  type FireworkParticle,
  type FireworkRocket,
  spawnFireworks,
  updateAndDrawFireworks,
} from './fireworks';
import {
  drawWickGlow,
  drawWickSparks,
  spawnWickSparks,
  type WickSpark,
} from './wick';

export function drawPhaseEffects(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  phase: GamePhase,
  wickSparks: WickSpark[],
  rockets: FireworkRocket[],
  fwParticles: FireworkParticle[],
  fireworksFiredRef: { current: boolean },
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
