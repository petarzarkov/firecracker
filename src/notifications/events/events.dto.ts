import type { DefaultEventsMap } from 'socket.io';
import { Server, Socket } from 'socket.io';
import { AIProvider } from '@/ai/enum/ai-provider.enum';
import type { EventMap, EventType } from '@/notifications/events/events';
import type { SanitizedUser } from '@/users/entity/user.entity';

export class WebSocketBaseMessage<T = unknown> {
  message!: string;
  payload!: T;
}

export class WebSocketMessage<Key extends EventType, T extends EventMap[Key]> {
  event!: Key;
  payload!: T;
}

export class BaseUserEvent {
  username!: string;
  timestamp!: Date;
}

export class ChatMessage extends BaseUserEvent {
  message!: string;
  picture!: string | null;
}

export class AIMessageRequest {
  provider!: AIProvider;
  model!: string;
  prompt!: string;
}

export class AIMessageChunk {
  requestId!: string;
  chunk!: string;
  provider!: AIProvider;
  model!: string;
  done!: boolean;
  username!: string;
}

export class AIMessageError {
  requestId!: string;
  error!: string;
  provider!: AIProvider;
  model!: string;
  username!: string;
}

// ---------------------------------------------------------------------------
// Game WebSocket payloads
// ---------------------------------------------------------------------------

export class GameTickPayload {
  /** Current multiplier, e.g. 1.42 */
  multiplier!: number;
  /** Milliseconds elapsed since round started */
  elapsed!: number;
}

export class GamePhasePayload {
  phase!: 'waiting' | 'running' | 'crashed';
  roundId!: string;
  /** sha256 of the server seed — for provably fair verification */
  seedHash!: string;
  /** ISO timestamp — only set for 'waiting' phase */
  waitingEndsAt?: string;
}

export class GameCrashedPayload {
  roundId!: string;
  crashPoint!: number;
  crashedAt!: Date;
  /** Raw seed revealed after crash for provably fair verification */
  seed!: string;
}

export class CrashedRoundSummary {
  roundId!: string;
  crashPoint!: number;
}

export class GameRoundStatePayload {
  phase!: 'waiting' | 'running' | 'crashed';
  roundId!: string | null;
  seedHash!: string | null;
  waitingEndsAt?: string;
  multiplier?: number;
  elapsed?: number;
  activeBets!: BetSummary[];
  recentCrashes!: CrashedRoundSummary[];
}

export class BetSummary {
  username!: string;
  betAmountCents!: number;
  isDemo!: boolean;
  cashedOutAt?: number;
}

export class BetPlacedPayload {
  username!: string;
  betAmountCents!: number;
  isDemo!: boolean;
}

export class BetCashedOutPayload {
  username!: string;
  multiplier!: number;
  payoutCents!: number;
  isDemo!: boolean;
}

export class BetAckPayload {
  success!: boolean;
  error?: string;
  /** Display name used in betPlaced broadcast — lets client identify their own bet. */
  username?: string;
  betAmountCents?: number;
}

export class CashOutAckPayload {
  success!: boolean;
  multiplier?: number;
  payoutCents?: number;
  error?: string;
}

export class WalletUpdatedPayload {
  balanceCents!: number;
}

// ---------------------------------------------------------------------------

export interface WebSocketEmitEvents {
  connected: (message: WebSocketBaseMessage<SanitizedUser>) => void;
  exception: (message: WebSocketBaseMessage) => void;
  notification: (
    message: WebSocketMessage<EventType, EventMap[EventType]>,
  ) => void;
  global_notification: (message: WebSocketBaseMessage) => void;
  userJoined: (data: BaseUserEvent) => void;
  userLeft: (data: BaseUserEvent) => void;
  userCount: (count: number) => void;
  message: (data: ChatMessage) => void;
  aiMessageChunk: (data: AIMessageChunk) => void;
  aiError: (data: AIMessageError) => void;
  // Game events
  gameTick: (data: GameTickPayload) => void;
  gamePhaseChange: (data: GamePhasePayload) => void;
  gameCrashed: (data: GameCrashedPayload) => void;
  gameRoundState: (data: GameRoundStatePayload) => void;
  betPlaced: (data: BetPlacedPayload) => void;
  betCashedOut: (data: BetCashedOutPayload) => void;
  betAck: (data: BetAckPayload) => void;
  cashOutAck: (data: CashOutAckPayload) => void;
  walletUpdated: (data: WalletUpdatedPayload) => void;
}

export type EmitToClient = <K extends keyof WebSocketEmitEvents>(
  ev: K,
  message: Parameters<WebSocketEmitEvents[K]>[0],
) => void;

export class ExtendedSocket extends Socket<
  DefaultEventsMap,
  WebSocketEmitEvents,
  DefaultEventsMap,
  { user: SanitizedUser | null; isDemo?: boolean }
> {}

export class WSServer extends Server<
  DefaultEventsMap,
  WebSocketEmitEvents,
  DefaultEventsMap,
  { user: SanitizedUser | null; isDemo?: boolean }
> {}
