/**
 * lib/rate-limiter.js — Per-user rate limiting for Wingman
 *
 * In-memory sliding-window rate limiter. Each user gets a bucket of
 * timestamps; requests older than the window are pruned on check.
 *
 * Ready to swap for Redis if you scale beyond one process.
 */

const buckets = new Map();

const DEFAULT_MAX     = parseInt(process.env.RATE_LIMIT_MAX || '5');
const DEFAULT_WINDOW  = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'); // 60s

/**
 * Check whether a user is within their rate limit.
 * @param {string} userId   Discord user ID
 * @param {number} [max]    Max requests in window (default: 5)
 * @param {number} [window] Window size in ms (default: 60000)
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
export function checkRateLimit(userId, max = DEFAULT_MAX, window = DEFAULT_WINDOW) {
  const now = Date.now();

  if (!buckets.has(userId)) {
    buckets.set(userId, []);
  }

  const timestamps = buckets.get(userId).filter(t => now - t < window);
  buckets.set(userId, timestamps);

  if (timestamps.length >= max) {
    const oldest = timestamps[0];
    const retryAfterMs = window - (now - oldest);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  timestamps.push(now);
  return { allowed: true, remaining: max - timestamps.length, retryAfterMs: 0 };
}

/**
 * Format a rate-limit denial into a user-friendly Discord message.
 */
export function rateLimitMessage(retryAfterMs) {
  const seconds = Math.ceil(retryAfterMs / 1000);
  return `⏱️ Slow down! Try again in **${seconds}s**. (Max ${DEFAULT_MAX} requests per minute)`;
}
