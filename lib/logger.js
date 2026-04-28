/**
 * lib/logger.js — Structured logging for Wingman
 *
 * JSON-formatted logs with timestamp, level, context, and duration.
 * Error/warn logs persisted to data/ directory (not cwd root).
 * Sensitive fields (userId, tokens) are automatically masked.
 */

import fs from 'fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOG_DIR = path.join(ROOT, 'data');
const ERROR_LOG_PATH = path.join(LOG_DIR, 'wingman-error.log');

// Ensure log directory exists
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? 1;

// Fields to mask in log output
const SENSITIVE_KEYS = ['token', 'apiKey', 'api_key', 'password', 'secret', 'refresh_token'];

function maskSensitive(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const masked = { ...meta };
  for (const key of Object.keys(masked)) {
    if (SENSITIVE_KEYS.some(s => key.toLowerCase().includes(s.toLowerCase()))) {
      masked[key] = typeof masked[key] === 'string'
        ? masked[key].slice(0, 6) + '***'
        : '***';
    }
  }
  return masked;
}

function maskUserId(meta) {
  if (!meta) return meta;
  const result = { ...meta };
  if (result.userId && typeof result.userId === 'string' && result.userId.length > 6) {
    result.userId = result.userId.slice(0, 4) + '****';
  }
  if (result.discordId && typeof result.discordId === 'string' && result.discordId.length > 6) {
    result.discordId = result.discordId.slice(0, 4) + '****';
  }
  return result;
}

function formatEntry(level, message, meta = {}) {
  const sanitized = maskUserId(maskSensitive(meta));
  const logStr = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...sanitized,
  });
  if (level === 'error' || level === 'warn') {
    try {
      fs.appendFileSync(ERROR_LOG_PATH, logStr + '\n');
    } catch {}
  }
  return logStr;
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
