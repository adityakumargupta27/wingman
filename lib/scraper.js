import { chromium } from 'playwright';

/**
 * Fetch job description from a URL using Playwright.
 * Includes bypasses for common ATS portals like Cloudflare/Workday.
 */
export async function fetchJobDescription(url) {
  let browser;
  try {
    // Run non-headless with window off-screen to bypass basic bot protection
    browser = await chromium.launch({ 
      headless: false, 
      args: [
        '--disable-blink-features=AutomationControlled',
        '--window-position=-32000,-32000'
      ]
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });
    
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000); // Give JS time to hydrate

    const text = await page.evaluate(() => {
      // Remove noise
      const remove = document.querySelectorAll('nav, footer, header, script, style, .cookie-banner');
      remove.forEach(el => el.remove());
      return document.body.innerText;
    });

    const title = await page.title();
    
    return { 
      text: text.slice(0, 8000), // Cap at 8k chars
      title, 
      url 
    };
  } catch (err) {
    return { text: `Could not fetch page: ${err.message}`, title: 'Unknown Role', url };
  } finally {
    if (browser) await browser.close();
  }
}
