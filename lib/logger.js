/**
 * lib/logger.js — Structured logging for Wingman
 *
 * JSON-formatted logs with timestamp, level, context, and duration.
 * Replaces raw console.log/error calls throughout the codebase.
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? 1;

function formatEntry(level, message, meta = {}) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta,
  });
}

export function debug(msg, meta) {
  if (CURRENT_LEVEL <= LOG_LEVELS.debug) console.log(formatEntry('debug', msg, meta));
}

export function info(msg, meta) {
  if (CURRENT_LEVEL <= LOG_LEVELS.info) console.log(formatEntry('info', msg, meta));
}

export function warn(msg, meta) {
  if (CURRENT_LEVEL <= LOG_LEVELS.warn) console.warn(formatEntry('warn', msg, meta));
}

export function error(msg, meta) {
  if (CURRENT_LEVEL <= LOG_LEVELS.error) console.error(formatEntry('error', msg, meta));
}

/**
 * Create a child logger with preset context (e.g., command name, user ID).
 */
export function child(context) {
  return {
    debug: (msg, meta) => debug(msg, { ...context, ...meta }),
    info:  (msg, meta) => info(msg, { ...context, ...meta }),
    warn:  (msg, meta) => warn(msg, { ...context, ...meta }),
    error: (msg, meta) => error(msg, { ...context, ...meta }),
  };
}

/**
 * Measure execution time of an async function.
 */
export async function timed(label, fn, context = {}) {
  const start = performance.now();
  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - start);
    info(`${label} completed`, { ...context, durationMs });
    return result;
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    error(`${label} failed`, { ...context, durationMs, error: err.message });
    throw err;
  }
}

export default { debug, info, warn, error, child, timed };
