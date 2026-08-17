/**
 * Values both sides read.
 *
 * Frozen objects rather than TypeScript `enum`s, matching the house style: an
 * `enum` is a runtime construct TypeScript invents, and `as const` narrows just as
 * well with an object that is only an object.
 *
 * These are also the server's drizzle column enums, so the database, the wire and
 * the client cannot disagree about what a status is.
 */

export const GameRoundStatus = Object.freeze({
  WAITING: 'waiting',
  RUNNING: 'running',
  CRASHED: 'crashed',
  FAILED: 'failed',
} as const);
export type GameRoundStatus =
  (typeof GameRoundStatus)[keyof typeof GameRoundStatus];

export const ROUND_STATUSES = [
  GameRoundStatus.WAITING,
  GameRoundStatus.RUNNING,
  GameRoundStatus.CRASHED,
  GameRoundStatus.FAILED,
] as const;

export const GameBetStatus = Object.freeze({
  ACTIVE: 'active',
  CASHED_OUT: 'cashed_out',
  LOST: 'lost',
  REFUNDED: 'refunded',
} as const);
export type GameBetStatus = (typeof GameBetStatus)[keyof typeof GameBetStatus];

export const BET_STATUSES = [
  GameBetStatus.ACTIVE,
  GameBetStatus.CASHED_OUT,
  GameBetStatus.LOST,
  GameBetStatus.REFUNDED,
] as const;

export const UserRole = Object.freeze({
  ADMIN: 'admin',
  USER: 'user',
} as const);
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const USER_ROLES = [UserRole.ADMIN, UserRole.USER] as const;

export const InviteStatus = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
} as const);
export type InviteStatus = (typeof InviteStatus)[keyof typeof InviteStatus];

export const INVITE_STATUSES = [
  InviteStatus.PENDING,
  InviteStatus.ACCEPTED,
  InviteStatus.EXPIRED,
] as const;

export const WalletTransactionType = Object.freeze({
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
  BET_DEBIT: 'bet_debit',
  WIN_CREDIT: 'win_credit',
  REFUND: 'refund',
} as const);
export type WalletTransactionType =
  (typeof WalletTransactionType)[keyof typeof WalletTransactionType];

export const TRANSACTION_TYPES = [
  WalletTransactionType.DEPOSIT,
  WalletTransactionType.WITHDRAWAL,
  WalletTransactionType.BET_DEBIT,
  WalletTransactionType.WIN_CREDIT,
  WalletTransactionType.REFUND,
] as const;
