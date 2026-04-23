/**
 * lib/scraper.js — Playwright web scraper for Wingman
 *
 * Fetches job descriptions from URLs. Uses headless mode by default
 * for server environments. Set HEADLESS=false for local debugging.
 */

import { chromium } from 'playwright';
import log from './logger.js';

const HEADLESS    = process.env.HEADLESS !== 'false';
const TIMEOUT_MS  = 20_000;
const MAX_CHARS   = 8_000;

/**
 * Fetch job description text from a URL using Playwright.
 * Includes bypass techniques for common ATS portals.
 */
export async function fetchJobDescription(url) {
  let browser;
  const startMs = performance.now();

  try {
    browser = await chromium.launch({
      headless: HEADLESS,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        ...(HEADLESS ? [] : ['--window-position=-32000,-32000']),
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
      },
    });

    const page = await context.newPage();
    // Bypass common bot detection variables
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });
    await page.waitForTimeout(3000); 

    // 3. Extract text using a more aggressive strategy for complex sites like Unstop
    const text = await page.evaluate(() => {
      // Remove noise
      const noise = document.querySelectorAll('script, style, nav, footer, .ads, .sidebar');
      noise.forEach(el => el.remove());
      
      // Try to find the main content first
      const main = document.querySelector('main') || document.querySelector('.opportunity-details') || document.body;
      return main.innerText;
    });

    const title = await page.title();
    const durationMs = Math.round(performance.now() - startMs);

    log.info('Job description scraped', { url, chars: text.length, durationMs });

    return {
      text: text.slice(0, MAX_CHARS),
      title,
      url,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startMs);
    log.error('Scraper failed', { url, error: err.message, durationMs });

    return {
      text: `Could not fetch page: ${err.message}`,
      title: 'Unknown Role',
      url,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
