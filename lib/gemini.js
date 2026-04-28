/**
 * lib/gemini.js — Gemini API wrapper for Wingman
 *
 * Wraps @google/generative-ai for job evaluation, company research,
 * and interview prep with retry logic and circuit breaker protection.
 *
 * Production features:
 *   - Exponential backoff retry (3 attempts)
 *   - Circuit breaker (trips after 5 consecutive failures, resets after 60s)
 *   - Request timeout (30s default)
 *   - Graceful error categorization
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import log from './logger.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('❌  GEMINI_API_KEY not set. Add it to your .env file.');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
const MAX_TOKENS    = parseInt(process.env.GEMINI_MAX_TOKENS || '8192');
const TIMEOUT_MS    = parseInt(process.env.GEMINI_TIMEOUT_MS || '30000');

// ── Circuit Breaker ──────────────────────────────────────────────────────────

const breaker = {
  failures:    0,
  threshold:   5,
  resetMs:     60_000,
  trippedAt:   null,

  get isOpen() {
    if (!this.trippedAt) return false;
    if (Date.now() - this.trippedAt > this.resetMs) {
      // Half-open: allow one request through to test recovery
      this.trippedAt = null;
      this.failures  = 0;
      log.info('Circuit breaker reset — allowing requests');
      return false;
    }
    return true;
  },

  recordSuccess() {
    this.failures  = 0;
    this.trippedAt = null;
  },

  recordFailure() {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.trippedAt = Date.now();
      log.error('Circuit breaker TRIPPED — blocking Gemini calls for 60s', {
        consecutiveFailures: this.failures,
      });
    }
  },
};

// ── Retry with exponential backoff ───────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call Gemini with retry logic, timeout, and circuit breaker.
 * @param {string} systemPrompt - The system/context prompt
 * @param {string} userContent  - The user's content (JD text, question, etc.)
 * @param {string} [modelName]  - Override model name
 * @returns {Promise<string>}   - Gemini's response text
 */
export async function callGemini(systemPrompt, userContent, modelName = DEFAULT_MODEL) {
  if (breaker.isOpen) {
    throw new GeminiError(
      'Wingman AI is temporarily unavailable due to high error rate. Please try again in 60 seconds.',
      'CIRCUIT_OPEN'
    );
  }

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: MAX_TOKENS,
    },
  });

  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await withTimeout(
        model.generateContent([
          { text: systemPrompt },
          { text: userContent },
        ]),
        TIMEOUT_MS
      );

      breaker.recordSuccess();
      return result.response.text();

    } catch (err) {
      lastError = err;
      const category = categorizeError(err);

      log.warn(`Gemini attempt ${attempt}/${maxRetries} failed`, {
        category,
        error: err.message?.slice(0, 200),
        model: modelName,
      });

      // Don't retry on non-transient errors
      if (category === 'AUTH' || category === 'INVALID_REQUEST') {
        breaker.recordFailure();
        throw new GeminiError(friendlyMessage(category, err), category);
      }

      // Wait before retry (exponential backoff: 1s, 2s, 4s)
      if (attempt < maxRetries) {
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        log.info(`Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
      }
    }
  }

  // All retries exhausted
  breaker.recordFailure();
  const category = categorizeError(lastError);
  throw new GeminiError(friendlyMessage(category, lastError), category);
}

// ── Timeout wrapper ──────────────────────────────────────────────────────────

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Gemini request timed out after ${ms}ms`));
    }, ms);

    promise
      .then(result => { clearTimeout(timer); resolve(result); })
      .catch(err =>   { clearTimeout(timer); reject(err); });
  });
}

// ── Error categorization ─────────────────────────────────────────────────────

function categorizeError(err) {
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('api_key') || msg.includes('permission') || msg.includes('403'))
    return 'AUTH';
  if (msg.includes('quota') || msg.includes('rate') || msg.includes('429') || msg.includes('resource_exhausted'))
    return 'RATE_LIMIT';
  if (msg.includes('timeout') || msg.includes('timed out'))
    return 'TIMEOUT';
  if (msg.includes('invalid') || msg.includes('400'))
    return 'INVALID_REQUEST';
  if (msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded'))
    return 'SERVER_ERROR';
  return 'UNKNOWN';
}

function friendlyMessage(category, err) {
  switch (category) {
    case 'AUTH':
      return '❌ Invalid Gemini API key — contact the server admin.';
    case 'RATE_LIMIT':
      return '⏳ Gemini rate limit hit — please wait 60 seconds and try again.';
    case 'TIMEOUT':
      return '⏱️ Gemini took too long to respond. Try again with a shorter job description.';
    case 'SERVER_ERROR':
      return '🔧 Gemini servers are temporarily overloaded. Please try again in a minute.';
    case 'INVALID_REQUEST':
      return `❌ Invalid request: ${err.message?.slice(0, 150) || 'Unknown error'}`;
    default:
      return `❌ AI evaluation failed: ${err.message?.slice(0, 150) || 'Unknown error'}`;
  }
}

class GeminiError extends Error {
  constructor(message, category) {
    super(message);
    this.name     = 'GeminiError';
    this.category = category;
  }
}

// ── Domain-specific wrappers ─────────────────────────────────────────────────

/**
 * Evaluate a job description against a CV.
 */
export async function evaluateJD({ systemPrompt, jdText }) {
  const MAX_JD_CHARS = 30_000;
  const truncated = jdText.length > MAX_JD_CHARS
    ? jdText.slice(0, MAX_JD_CHARS) + '\n\n[JD truncated to 30k chars]'
    : jdText;

  return callGemini(systemPrompt, `\n\nJOB DESCRIPTION TO EVALUATE:\n\n${truncated}`);
}

/**
 * Run a company deep-research query.
 */
export async function researchCompany({ systemPrompt, companyName }) {
  return callGemini(systemPrompt, `\n\nCOMPANY TO RESEARCH:\n\n${companyName}`);
}

/**
 * Generate interview questions for a role.
 */
export async function generateInterviewQuestions({ systemPrompt, role }) {
  return callGemini(systemPrompt, `\n\nROLE:\n\n${role}`);
}

export { DEFAULT_MODEL, GeminiError };
