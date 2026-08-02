import { chromium } from 'playwright';
async function run() {
  try {
    console.log('Attempting to launch Playwright Chromium...');
    const browser = await chromium.launch({ headless: true });
    console.log('Playwright Chromium launched successfully! ✅');
    await browser.close();
  } catch (err) {
    console.error('Playwright Chromium launch FAILED: ❌', err.message);
  }
}
run();
