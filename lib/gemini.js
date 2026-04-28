/**
 * lib/gemini.js — AI wrapper for Wingman (OpenAI/OpenRouter backend)
 *
 * Wraps OpenAI/OpenRouter for job evaluation, company research,
 * and interview prep with retry logic and circuit breaker protection.
 *
 * NOTE: Function names kept as callGemini/evaluateJD etc. for backward
 *       compatibility with all command files and telegram.js
 */

import OpenAI from 'openai';
import log from './logger.js';

// ── AI Setup ──────────────────────────────────────────────────────────────────

const apiKey = process.env.OPENAI_API_KEY;
let aiEnabled = false;
let openai = null;

if (!apiKey || apiKey.includes('your_') || apiKey.trim().length < 10) {
  log.error('❌ OPENAI_API_KEY not set or invalid. AI features are DISABLED.');
} else {
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  openai = new OpenAI({
    apiKey,
    baseURL,
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/adity/wingman',
      'X-Title': 'Wingman Bot',
    }
  });
  aiEnabled = true;
  log.info('AI Client initialized', { 
    keyPrefix: apiKey.slice(0, 12) + '...',
    baseURL
  });
}

const DEFAULT_MODEL  = process.env.AI_MODEL || 'gpt-4o-mini';
const FALLBACK_MODEL = 'gpt-4o-mini';
const MAX_TOKENS     = parseInt(process.env.AI_MAX_TOKENS || '8192');
const TIMEOUT_MS     = parseInt(process.env.AI_TIMEOUT_MS || '45000');

// ── Startup Validation ──────────────────────────────────────────────────────

if (aiEnabled) {
  (async () => {
    try {
      const result = await withTimeout(
        openai.chat.completions.create({
          model: FALLBACK_MODEL,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
          max_tokens: 10,
        }),
        15000
      );
      log.info('✅ AI API key validated successfully');
    } catch (err) {
      log.warn('⚠️ AI startup validation failed (may be transient)', { error: err.message });
    }
  })();
}

// ── Circuit Breaker ──────────────────────────────────────────────────────────

const breaker = {
  failures:    0,
  threshold:   5,
  resetMs:     60_000,
  trippedAt:   null,

  get isOpen() {
    if (!this.trippedAt) return false;
    if (Date.now() - this.trippedAt > this.resetMs) {
      this.trippedAt = null;
      this.failures  = 0;
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
      log.error('Circuit breaker TRIPPED — blocking AI calls for 60s');
    }
  },
};

// ── Retry with exponential backoff ───────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function callGemini(systemPrompt, userContent, modelName = DEFAULT_MODEL) {
  if (!aiEnabled || !openai) {
    throw new GeminiError('❌ AI API key is missing or invalid.', 'API_KEY_MISSING');
  }

  if (breaker.isOpen) {
    throw new GeminiError('Wingman AI is temporarily unavailable. Please try again in 60 seconds.', 'CIRCUIT_OPEN');
  }

  const modelsToTry = [modelName];
  if (modelName !== FALLBACK_MODEL) modelsToTry.push(FALLBACK_MODEL);

  for (const currentModel of modelsToTry) {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await withTimeout(
          openai.chat.completions.create({
            model: currentModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            max_tokens: MAX_TOKENS,
            temperature: 0.4,
          }),
          TIMEOUT_MS
        );

        const text = result.choices[0]?.message?.content || '';
        if (!text) throw new Error('Empty response from AI');

        breaker.recordSuccess();
        return text;

      } catch (err) {
        lastError = err;
        const category = categorizeError(err);

        log.warn(`AI attempt ${attempt}/${maxRetries} failed`, { category, model: currentModel });

        if (category === 'AUTH' || category === 'BILLING') {
          aiEnabled = false;
          breaker.recordFailure();
          throw new GeminiError(friendlyMessage(category, err), category);
        }

        if (attempt < maxRetries) {
          await sleep(1000 * Math.pow(2, attempt - 1));
        }
      }
    }
    if (currentModel !== modelsToTry[modelsToTry.length - 1]) continue;
    breaker.recordFailure();
    const category = categorizeError(lastError);
    throw new GeminiError(friendlyMessage(category, lastError), category);
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`AI request timed out after ${ms}ms`)), ms);
    promise.then(res => { clearTimeout(timer); resolve(res); }).catch(err => { clearTimeout(timer); reject(err); });
  });
}

function categorizeError(err) {
  const msg = (err.message || '').toLowerCase();
  const status = err.status || 0;
  if (msg.includes('api key') || status === 401) return 'AUTH';
  if (msg.includes('quota') || msg.includes('billing') || status === 402) return 'BILLING';
  if (msg.includes('model_not_found') || status === 404) return 'MODEL_NOT_FOUND';
  if (status === 429) return 'RATE_LIMIT';
  return 'UNKNOWN';
}

function friendlyMessage(category, err) {
  switch (category) {
    case 'AUTH': return '❌ Invalid API key. Please update OPENAI_API_KEY in .env';
    case 'BILLING': return '💳 AI account has insufficient credits.';
    case 'RATE_LIMIT': return '⏳ Rate limit hit — please wait 60 seconds.';
    default: return `❌ AI failed: ${err.message?.slice(0, 100)}`;
  }
}

class GeminiError extends Error {
  constructor(message, category) {
    super(message);
    this.name = 'GeminiError';
    this.category = category;
  }
}

export async function evaluateJD({ systemPrompt, jdText }) {
  const truncated = jdText.length > 30000 ? jdText.slice(0, 30000) : jdText;
  return callGemini(systemPrompt, `JOB DESCRIPTION:\n\n${truncated}`);
}

export async function researchCompany({ systemPrompt, companyName }) {
  return callGemini(systemPrompt, `COMPANY: ${companyName}`);
}

export async function generateInterviewQuestions({ systemPrompt, role }) {
  return callGemini(systemPrompt, `ROLE: ${role}`);
}

export function isGeminiEnabled() { return aiEnabled; }
export { DEFAULT_MODEL, GeminiError };
