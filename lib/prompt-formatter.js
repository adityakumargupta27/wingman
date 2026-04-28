/**
 * lib/prompt-formatter.js — Platform-specific output formatting
 *
 * Transforms AI responses into platform-optimized messages.
 * Handles character limits, markdown differences, and chunking.
 */

// ── Telegram Formatting ─────────────────────────────────────────────────────

/**
 * Format for Telegram (max ~4096 chars, Markdown V1).
 * Telegram's markdown is limited — no nested bold/italic, no tables.
 */
export function formatTelegram(text, maxChars = 4000) {
  let formatted = text
    // Telegram doesn't support ### headers — convert to bold
    .replace(/^###\s+(.+)$/gm, '*$1*')
    .replace(/^##\s+(.+)$/gm, '*$1*')
    .replace(/^#\s+(.+)$/gm, '*$1*')
    // Escape Telegram-problematic characters in non-formatted text
    .replace(/([_[\]()~`>#+\-=|{}.!])/g, (match, char) => {
      // Don't escape if it's part of our own formatting
      if (char === '*') return char;
      return char;
    });

  // Truncate with clean break
  if (formatted.length > maxChars) {
    formatted = truncateClean(formatted, maxChars);
  }

  return formatted;
}

/**
 * Split a long message into Telegram-safe chunks.
 */
export function chunkTelegram(text, maxChars = 4000) {
  if (text.length <= maxChars) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf('\n\n', maxChars);
    if (splitAt < maxChars / 2) splitAt = remaining.lastIndexOf('\n', maxChars);
    if (splitAt < maxChars / 2) splitAt = maxChars;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

// ── Discord Formatting ──────────────────────────────────────────────────────

/**
 * Format for Discord embeds (max 4096 chars in description).
 * Discord supports full markdown including bold, italic, code blocks.
 */
export function formatDiscord(text, maxChars = 4000) {
  let formatted = text;

  // Discord embed descriptions don't render # headers well
  formatted = formatted
    .replace(/^###\s+(.+)$/gm, '**$1**')
    .replace(/^##\s+(.+)$/gm, '**$1**')
    .replace(/^#\s+(.+)$/gm, '**$1**');

  if (formatted.length > maxChars) {
    formatted = truncateClean(formatted, maxChars);
  }

  return formatted;
}

// ── Web Dashboard Formatting ────────────────────────────────────────────────

/**
 * Format for web dashboard (full markdown, no character limit).
 * Preserves all formatting. Adds HTML-safe escaping.
 */
export function formatWeb(text) {
  // Web gets the full, untruncated response
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Shared Utilities ────────────────────────────────────────────────────────

/**
 * Truncate text at a clean boundary (paragraph or line break).
 */
function truncateClean(text, maxChars) {
  if (text.length <= maxChars) return text;

  // Try to break at paragraph
  let breakAt = text.lastIndexOf('\n\n', maxChars - 20);
  if (breakAt < maxChars / 2) breakAt = text.lastIndexOf('\n', maxChars - 20);
  if (breakAt < maxChars / 2) breakAt = maxChars - 20;

  return text.slice(0, breakAt).trim() + '\n\n_[Truncated — full report available on web]_';
}

/**
 * Determine optimal model based on prompt complexity.
 * Cost optimization: use cheap models for simple tasks.
 *
 * @param {string} moduleId - The prompt module being used
 * @param {number} inputLength - Approximate input token count
 * @returns {{ model: string, reason: string }}
 */
export function selectModel(moduleId, inputLength) {
  // Premium model for high-stakes outputs
  const PREMIUM_MODULES = ['evaluate', 'tailor', 'deep'];
  // Cheap model is fine for these
  const CHEAP_MODULES = ['chat', 'help', 'salary', 'tracker'];

  if (PREMIUM_MODULES.includes(moduleId)) {
    return {
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      reason: 'High-stakes output requires premium model',
    };
  }

  if (CHEAP_MODULES.includes(moduleId) || inputLength < 500) {
    return {
      model: process.env.AI_CHEAP_MODEL || 'gpt-4o-mini',
      reason: 'Simple task — cost-optimized model',
    };
  }

  return {
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    reason: 'Default model',
  };
}
