/**
 * lib/job-scheduler.js — Background job ingestion scheduler
 *
 * Runs periodic ingestion cycles:
 *   - Full cycle: every 6 hours (all sources)
 *   - Cleanup: daily (deactivate old listings)
 *
 * Does NOT block bot startup. Runs on setTimeout chains.
 */

import { ingestAllJobs } from './job-sources.js';
import { upsertJobs, deactivateOldJobs, getJobCount } from './job-db.js';
import log from './logger.js';

const INGESTION_INTERVAL = 6 * 60 * 60 * 1000;  // 6 hours
const CLEANUP_INTERVAL   = 24 * 60 * 60 * 1000;  // 24 hours
const STARTUP_DELAY      = 30 * 1000;             // 30s after boot

let isRunning = false;
let ingestionTimer = null;
let cleanupTimer = null;

/**
 * Run a single ingestion cycle.
 */
export async function runIngestionCycle() {
  if (isRunning) {
    log.warn('Ingestion already in progress, skipping');
    return { skipped: true };
  }

  isRunning = true;
  const startMs = performance.now();

  try {
    log.info('Starting job ingestion cycle');

    // 1. Fetch from all sources
    const rawJobs = await ingestAllJobs();

    if (rawJobs.length === 0) {
      log.warn('Ingestion returned 0 jobs — sources may be down');
      return { total: 0, inserted: 0 };
    }

    // 2. Upsert into database
    const inserted = upsertJobs(rawJobs);

    const durationMs = Math.round(performance.now() - startMs);
    const totalJobs = getJobCount();

    log.info('Ingestion cycle complete', {
      fetched: rawJobs.length,
      inserted,
      totalActive: totalJobs,
      durationMs,
    });

    return { total: rawJobs.length, inserted, totalActive: totalJobs, durationMs };

  } catch (err) {
    log.error('Ingestion cycle failed', { error: err.message });
    return { error: err.message };
  } finally {
    isRunning = false;
  }
}

/**
 * Start the background ingestion scheduler.
 * Runs first cycle after STARTUP_DELAY, then every INGESTION_INTERVAL.
 */
export function startJobScheduler() {
  log.info('Job scheduler initialized', {
    interval: `${INGESTION_INTERVAL / 3600000}h`,
    startupDelay: `${STARTUP_DELAY / 1000}s`,
  });

  // First run after startup delay
  setTimeout(async () => {
    const jobCount = getJobCount();

    if (jobCount === 0) {
      log.info('No jobs in database — running initial ingestion');
      await runIngestionCycle();
    } else {
      log.info(`${jobCount} jobs already in database — skipping startup ingestion`);
    }

    // Schedule recurring ingestion
    ingestionTimer = setInterval(() => {
      runIngestionCycle().catch(err => {
        log.error('Scheduled ingestion failed', { error: err.message });
      });
    }, INGESTION_INTERVAL);

  }, STARTUP_DELAY);

  // Daily cleanup of old listings
  cleanupTimer = setInterval(() => {
    try {
      deactivateOldJobs(30);
      log.info('Old job cleanup complete');
    } catch (err) {
      log.error('Job cleanup failed', { error: err.message });
    }
  }, CLEANUP_INTERVAL);
}

/**
 * Stop the scheduler (for graceful shutdown).
 */
export function stopJobScheduler() {
  if (ingestionTimer) clearInterval(ingestionTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);
}

/**
 * Get scheduler status.
 */
export function getSchedulerStatus() {
  return {
    isRunning,
    totalJobs: getJobCount(),
    intervalHours: INGESTION_INTERVAL / 3600000,
  };
}
