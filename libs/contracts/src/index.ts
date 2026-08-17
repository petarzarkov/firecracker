/**
 * The wire between `apps/be` and `apps/fe`.
 *
 * Types only, plus the event *names* as frozen objects - no zod, no runtime
 * dependency the browser has to carry. What the server does with a frame after it
 * arrives (queues, jobs, the database) is not in here; see the README.
 */
export * from './enums.js';
export * from './game.js';
export * from './chat.js';
