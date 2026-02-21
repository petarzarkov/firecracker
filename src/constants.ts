import { PaginationOrder } from '@/core/pagination/enum/pagination-order.enum';

export const REQUEST_ID_HEADER_KEY = 'X-Request-Id';

export const BASE_USER_TEST_PASS = 'Test123$';

export const GLOBAL_PREFIX = 'api';
export const DOCS_AFFIX = 'docs';

export const PASSWORD_HASH_ROUNDS = 10;

export const LOGGER = {
  defaultMaskFields: [
    'accessToken',
    'jwt',
    'password',
    'secret',
    'key',
    'phone',
  ],
  defaultFilterEvents: [
    `/${GLOBAL_PREFIX}/service/up`,
    `/${GLOBAL_PREFIX}/service/health`,
    '/favicon.ico',
  ],
} as const;

// Time constants (** in milliseconds **)
export const MILLISECOND = 1 as const;
export const SECOND = 1000 * MILLISECOND;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const FILES = {
  MIN_SIZE: 1024, // 1KB
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  MIN_FILE_NAME_LENGTH: 6,
  MAX_FILES: 6,
} as const;

export const PAGINATION = Object.freeze({
  ORDER_BY_PRECEDENCE: Object.freeze(['updatedAt', 'createdAt', 'id']),
  DEFAULT_ORDER: PaginationOrder.DESC,
  MIN_TAKE: 1,
  DEFAULT_TAKE: 10,
  MAX_TAKE: 50,
  MAX_SEARCH: 256,
  MAX_CURSOR: 512,
});

export const STRING_LENGTH = {
  EMAIL_MAX: 254, // RFC 5321
  PASSWORD_HASH_MAX: 128, // bcrypt ~60 chars + buffer
  SHORT_MAX: 128, // tokens, IDs, codes
  MEDIUM_MAX: 255, // names, entity names
  PATH_MAX: 1024, // S3 paths, URLs
  TEXT_MAX: 10_000, // AI prompts, long-form text
  EXTENSION_MAX: 32, // file extensions
  MIMETYPE_MAX: 128, // MIME types
  MODEL_NAME_MAX: 256, // AI model identifiers
} as const;

export const JOB_HANDLER_METADATA = 'JOB_HANDLER_METADATA';

export const GAME = {
  /** Duration of the betting window before each rocket launches (ms) */
  WAITING_PHASE_MS: 10_000,
  /** Cool-down between rounds (ms) */
  COOLDOWN_MS: 5_000,
  /** How often the multiplier tick is broadcast to clients (ms) */
  TICK_INTERVAL_MS: 100,
  /** Divisor in the e^(elapsed/DIVISOR) multiplier formula */
  MULTIPLIER_DIVISOR: 15_000,
  /** Minimum real bet in cents ($1) */
  MIN_BET_CENTS: 100,
  /** Starting virtual balance for demo/guest users in cents ($1,000) */
  DEMO_INITIAL_BALANCE_CENTS: 100_000,
  /** Redis TTL for demo wallet keys (seconds) */
  DEMO_WALLET_TTL_SECONDS: 7_200,
} as const;
