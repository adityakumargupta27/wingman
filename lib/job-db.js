/**
 * lib/job-db.js — Job Database Schema + CRUD for Wingman
 *
 * Extends the existing SQLite database with:
 *   - candidate_profiles: structured user profile data
 *   - jobs: ingested job listings with dedup hash
 *   - recommendations: scored matches with feedback tracking
 *
 * Uses the same sql.js persistence pattern as lib/db.js.
 */

import db from './db.js';
import log from './logger.js';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT    = dirname(dirname(fileURLToPath(import.meta.url)));
const DB_PATH = resolve(ROOT, process.env.DB_PATH || './data/wingman.db');

function persist() {
  writeFileSync(DB_PATH, db.export());
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null;
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    persist();
  } catch (err) {
    log.error('JobDB run failed', { error: err.message, sql: sql.slice(0, 80) });
  }
}

// ── Schema Migration ─────────────────────────────────────────────────────────

db.run(`
  CREATE TABLE IF NOT EXISTS candidate_profiles (
    user_id          TEXT PRIMARY KEY,
    level            TEXT DEFAULT 'student',
    experience_years INTEGER DEFAULT 0,
    skills           TEXT DEFAULT '[]',
    preferred_roles  TEXT DEFAULT '[]',
    avoid_roles      TEXT DEFAULT '[]',
    locations        TEXT DEFAULT '["Remote"]',
    strength_scores  TEXT DEFAULT '{}',
    salary_band      TEXT DEFAULT 'intern/fresher',
    updated_at       INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    source           TEXT NOT NULL,
    source_id        TEXT UNIQUE,
    company          TEXT NOT NULL,
    title            TEXT NOT NULL,
    title_normalized TEXT,
    location         TEXT,
    url              TEXT,
    description      TEXT,
    skills           TEXT DEFAULT '[]',
    experience_min   INTEGER DEFAULT 0,
    experience_max   INTEGER DEFAULT 99,
    employment_type  TEXT DEFAULT 'full-time',
    quality_score    REAL DEFAULT 5.0,
    posted_at        TEXT,
    ingested_at      INTEGER DEFAULT (strftime('%s','now')),
    is_active        INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS recommendations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          TEXT NOT NULL,
    job_id           INTEGER NOT NULL,
    fit_score        REAL NOT NULL,
    components       TEXT DEFAULT '{}',
    reasons          TEXT DEFAULT '[]',
    gaps             TEXT DEFAULT '[]',
    shown_at         INTEGER DEFAULT (strftime('%s','now')),
    clicked          INTEGER DEFAULT 0,
    applied          INTEGER DEFAULT 0,
    saved            INTEGER DEFAULT 0,
    hidden           INTEGER DEFAULT 0,
    UNIQUE(user_id, job_id)
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_source_id ON jobs(source_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
  CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(is_active);
  CREATE INDEX IF NOT EXISTS idx_recs_user ON recommendations(user_id);
  CREATE INDEX IF NOT EXISTS idx_recs_score ON recommendations(fit_score);
`);
persist();
log.info('Job database schema initialized');

// ── Candidate Profile CRUD ───────────────────────────────────────────────────

export function upsertCandidateProfile(userId, profile) {
  run(`
    INSERT INTO candidate_profiles (user_id, level, experience_years, skills, preferred_roles, avoid_roles, locations, strength_scores, salary_band)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      level = excluded.level,
      experience_years = excluded.experience_years,
      skills = excluded.skills,
      preferred_roles = excluded.preferred_roles,
      avoid_roles = excluded.avoid_roles,
      locations = excluded.locations,
      strength_scores = excluded.strength_scores,
      salary_band = excluded.salary_band,
      updated_at = strftime('%s','now')
  `, [
    userId,
    profile.level,
    profile.experience_years,
    JSON.stringify(profile.skills),
    JSON.stringify(profile.preferred_roles),
    JSON.stringify(profile.avoid_roles),
    JSON.stringify(profile.locations),
    JSON.stringify(profile.strength_score || {}),
    profile.salary_band,
  ]);
}

export function getCandidateProfile(userId) {
  const row = queryOne('SELECT * FROM candidate_profiles WHERE user_id = ?', [userId]);
  if (!row) return null;
  return {
    ...row,
    skills: JSON.parse(row.skills || '[]'),
    preferred_roles: JSON.parse(row.preferred_roles || '[]'),
    avoid_roles: JSON.parse(row.avoid_roles || '[]'),
    locations: JSON.parse(row.locations || '["Remote"]'),
    strength_score: JSON.parse(row.strength_scores || '{}'),
  };
}

// ── Job CRUD ─────────────────────────────────────────────────────────────────

/**
 * Upsert jobs from ingestion. Deduplicates by source_id.
 * Returns count of new jobs inserted.
 */
export function upsertJobs(jobs) {
  let inserted = 0;
  for (const job of jobs) {
    try {
      const existing = queryOne('SELECT id FROM jobs WHERE source_id = ?', [job.source_id]);
      if (existing) {
        // Update existing
        run(`
          UPDATE jobs SET
            title = ?, location = ?, url = ?, description = ?,
            skills = ?, experience_min = ?, experience_max = ?,
            employment_type = ?, posted_at = ?, is_active = 1
          WHERE source_id = ?
        `, [
          job.title, job.location, job.url, job.description,
          JSON.stringify(job.skills || []), job.experience_min, job.experience_max,
          job.employment_type, job.posted_at, job.source_id,
        ]);
      } else {
        run(`
          INSERT INTO jobs (source, source_id, company, title, title_normalized, location, url, description, skills, experience_min, experience_max, employment_type, posted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          job.source, job.source_id, job.company, job.title,
          job.title?.toLowerCase(), job.location, job.url,
          (job.description || '').slice(0, 3000),
          JSON.stringify(job.skills || []),
          job.experience_min, job.experience_max, job.employment_type,
          job.posted_at,
        ]);
        inserted++;
      }
    } catch (err) {
      // Unique constraint or other error — skip silently
    }
  }
  log.info('Jobs upserted', { total: jobs.length, inserted });
  return inserted;
}

/**
 * Get all active jobs (for scoring).
 */
export function getActiveJobs(limit = 2000) {
  const rows = queryAll(`
    SELECT * FROM jobs
    WHERE is_active = 1
    ORDER BY ingested_at DESC
    LIMIT ?
  `, [limit]);

  return rows.map(row => ({
    ...row,
    skills: JSON.parse(row.skills || '[]'),
  }));
}

/**
 * Get active jobs count.
 */
export function getJobCount() {
  const row = queryOne('SELECT COUNT(*) as count FROM jobs WHERE is_active = 1');
  return row?.count || 0;
}

/**
 * Mark old jobs as inactive (older than N days).
 */
export function deactivateOldJobs(daysOld = 30) {
  const cutoff = Math.floor(Date.now() / 1000) - (daysOld * 86400);
  run('UPDATE jobs SET is_active = 0 WHERE ingested_at < ? AND is_active = 1', [cutoff]);
}

// ── Recommendation CRUD ──────────────────────────────────────────────────────

/**
 * Save scored recommendations for a user.
 */
export function saveRecommendations(userId, scoredJobs) {
  for (const scored of scoredJobs) {
    try {
      run(`
        INSERT INTO recommendations (user_id, job_id, fit_score, components, reasons, gaps)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, job_id) DO UPDATE SET
          fit_score = excluded.fit_score,
          components = excluded.components,
          reasons = excluded.reasons,
          gaps = excluded.gaps,
          shown_at = strftime('%s','now')
      `, [
        userId,
        scored.job.id || 0,
        scored.score,
        JSON.stringify(scored.components),
        JSON.stringify(scored.reasons),
        JSON.stringify(scored.gaps),
      ]);
    } catch {}
  }
}

/**
 * Get user's recent recommendations.
 */
export function getUserRecommendations(userId, limit = 20) {
  return queryAll(`
    SELECT r.*, j.company, j.title, j.location, j.url, j.employment_type, j.skills as job_skills
    FROM recommendations r
    JOIN jobs j ON r.job_id = j.id
    WHERE r.user_id = ? AND r.hidden = 0
    ORDER BY r.fit_score DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Record feedback on a recommendation.
 */
export function recordFeedback(userId, jobId, action) {
  const validActions = ['clicked', 'applied', 'saved', 'hidden'];
  if (!validActions.includes(action)) return;

  run(`
    UPDATE recommendations SET ${action} = 1
    WHERE user_id = ? AND job_id = ?
  `, [userId, jobId]);
}

/**
 * Get user's saved jobs.
 */
export function getSavedJobs(userId, limit = 20) {
  return queryAll(`
    SELECT r.*, j.company, j.title, j.location, j.url, j.employment_type
    FROM recommendations r
    JOIN jobs j ON r.job_id = j.id
    WHERE r.user_id = ? AND r.saved = 1
    ORDER BY r.shown_at DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Get feedback stats for a user (for preference learning).
 */
export function getUserFeedbackStats(userId) {
  const clicked = queryAll(`
    SELECT j.title, j.company, j.skills as job_skills
    FROM recommendations r JOIN jobs j ON r.job_id = j.id
    WHERE r.user_id = ? AND r.clicked = 1
    ORDER BY r.shown_at DESC LIMIT 20
  `, [userId]);

  const hidden = queryAll(`
    SELECT j.title, j.company
    FROM recommendations r JOIN jobs j ON r.job_id = j.id
    WHERE r.user_id = ? AND r.hidden = 1
    ORDER BY r.shown_at DESC LIMIT 20
  `, [userId]);

  return { clicked, hidden };
}
