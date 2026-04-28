/**
 * lib/scraper.js — Playwright web scraper for Wingman
 *
 * Production-grade scraper with:
 *   - User-agent rotation
 *   - Anti-bot page detection (Cloudflare, 403, 404, CAPTCHA)
 *   - Content quality validation (minimum length, garbage detection)
 *   - Timeout handling with graceful fallback
 *   - NEVER passes error text to LLM — throws clean errors instead
 */

import { chromium } from 'playwright';
import log from './logger.js';

const HEADLESS   = process.env.HEADLESS !== 'false';
const TIMEOUT_MS = 25_000;
const MAX_CHARS  = 10_000;
const MIN_CHARS  = 150; // Pages with less than this are likely blocked/empty

// Rotate user agents to reduce fingerprinting
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Patterns that indicate a blocked or error page
const BLOCK_PATTERNS = [
  'access denied', 'attention required', 'cloudflare', 'just a moment',
  'checking your browser', 'ray id', 'please verify you are a human',
  'enable javascript', 'captcha', 'bot detection', 'unusual traffic',
  'forbidden', '403 forbidden',
];

const NOT_FOUND_PATTERNS = [
  '404 not found', 'page not found', 'this page doesn\'t exist',
  'job no longer available', 'this position has been filled',
  'listing has expired',
];

/**
 * Fetch page content from a URL using Playwright.
 * Returns { text, title, url } on success.
 * Throws a CLEAN, user-facing error on failure — never raw Playwright errors.
 */
export async function fetchJobDescription(url) {
  // Validate URL format
  try {
    new URL(url);
  } catch {
    throw new ScraperError('Invalid URL format. Please provide a valid link starting with https://');
  }

  let browser;
  const startMs = performance.now();

  try {
    browser = await chromium.launch({
      headless: HEADLESS,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        ...(HEADLESS ? [] : ['--window-position=-32000,-32000']),
      ],
    });

    const context = await browser.newContext({
      userAgent: randomUA(),
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.google.com/',
      },
    });

    const page = await context.newPage();

    // Bypass common bot detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // Override permissions query
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(params);
    });

    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });

    // Check HTTP status
    if (response && response.status() >= 400) {
      throw new ScraperError(`Page returned HTTP ${response.status()}. The job listing may have been removed.`);
    }

    // Wait for dynamic content to render
    await page.waitForTimeout(2500);

    // Extract and validate content
    const { text, isBlocked, isNotFound } = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const lower = bodyText.toLowerCase();

      return {
        text: (() => {
          // Remove noise elements
          const noise = document.querySelectorAll('script, style, nav, footer, header, .ads, .sidebar, .cookie-banner, [role="navigation"]');
          noise.forEach(el => el.remove());

          // Try specific content containers first
          const selectors = [
            'main', 'article', '[role="main"]',
            '.job-description', '.posting-page', '.opportunity-details',
            '#job-detail', '.job-content', '.description',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.innerText.trim().length > 200) return el.innerText.trim();
          }

          return document.body.innerText.trim();
        })(),
        isBlocked: lower.includes('access denied') || lower.includes('attention required') ||
                   lower.includes('checking your browser') || lower.includes('just a moment') ||
                   lower.includes('captcha') || lower.includes('ray id'),
        isNotFound: lower.includes('page not found') || lower.includes('404') ||
                    lower.includes('no longer available') || lower.includes('listing has expired'),
      };
    });

    if (isBlocked) {
      throw new ScraperError(
        '🛡️ This site has anti-bot protection. I couldn\'t access the job page.\n' +
        'Please copy and paste the job description text instead.'
      );
    }

    if (isNotFound) {
      throw new ScraperError(
        '🔍 This job listing appears to have been removed or expired.\n' +
        'Please check the URL or paste the job description text.'
      );
    }

    if (!text || text.length < MIN_CHARS) {
      throw new ScraperError(
        '📄 Could not extract meaningful content from this page.\n' +
        'The site may require login or the content loaded via JavaScript.\n' +
        'Please paste the job description text directly.'
      );
    }

    const title = await page.title();
    const durationMs = Math.round(performance.now() - startMs);

    log.info('Page scraped successfully', { url, chars: text.length, durationMs });

    return {
      text: text.slice(0, MAX_CHARS),
      title,
      url,
    };

  } catch (err) {
    const durationMs = Math.round(performance.now() - startMs);

    // If it's already our clean error, rethrow it
    if (err instanceof ScraperError) {
      log.warn('Scraper returned clean error', { url, error: err.message, durationMs });
      throw err;
    }

    // For Playwright errors, wrap in a clean user-facing message
    log.error('Scraper internal error', { url, error: err.message, durationMs });

    if (err.message.includes('Timeout')) {
      throw new ScraperError(
        '⏳ The page took too long to load.\n' +
        'This usually means heavy anti-bot protection.\n' +
        'Please paste the job description text instead.'
      );
    }

    throw new ScraperError(
      '❌ Unable to fetch this page. Please paste the job description text directly.'
    );

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Clean error class for scraper failures.
 * These messages are safe to show directly to users.
 */
export class ScraperError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScraperError';
    this.isUserFacing = true;
  }
}
