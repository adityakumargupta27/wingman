/**
 * lib/auto-apply.js — Automated Application Engine
 *
 * Uses Playwright to fill out job application forms automatically.
 * Supports: Lever, Greenhouse.
 */

import { chromium } from 'playwright';
import log from './logger.js';

export async function autoApply(url, userData) {
  log.info('Starting auto-apply', { url, user: userData.name });
  
  const browser = await chromium.launch({ headless: true }); // Use headless: false for debugging
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    if (url.includes('lever.co')) {
      await handleLever(page, userData);
    } else if (url.includes('greenhouse.io')) {
      await handleGreenhouse(page, userData);
    } else {
      throw new Error('Unsupported ATS for auto-apply');
    }

    // In a real scenario, we would click the submit button here.
    // For safety, we will only fill the form and return a success message.
    // await page.click('button[type="submit"]');

    log.info('Auto-apply form filled successfully', { url });
    return true;
  } catch (err) {
    log.error('Auto-apply failed', { url, error: err.message });
    throw err;
  } finally {
    // await browser.close(); // Keep open if you want to inspect
    await browser.close();
  }
}

async function handleLever(page, userData) {
  await page.fill('input[name="name"]', userData.name);
  await page.fill('input[name="email"]', userData.email);
  if (userData.phone) await page.fill('input[name="phone"]', userData.phone);
  if (userData.linkedin) await page.fill('input[name="urls[LinkedIn]"]', userData.linkedin);
  if (userData.github) await page.fill('input[name="urls[GitHub]"]', userData.github);
  
  // Resume upload (if path provided)
  if (userData.resumePath) {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('input[type="file"]')
    ]);
    await fileChooser.setFiles(userData.resumePath);
  }
}

async function handleGreenhouse(page, userData) {
  await page.fill('input#first_name', userData.name.split(' ')[0]);
  await page.fill('input#last_name', userData.name.split(' ').slice(1).join(' ') || 'User');
  await page.fill('input#email', userData.email);
  if (userData.phone) await page.fill('input#phone', userData.phone);
  
  if (userData.resumePath) {
    await page.setInputFiles('input[type="file"]', userData.resumePath);
  }
}
