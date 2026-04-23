/**
 * lib/db.js — SQLite database helpers for Wingman (using sql.js)
 *
 * Uses sql.js (pure JS/WASM) — no native compilation required.
 * Data is persisted to disk by writing the DB file after mutations.
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import log from './logger.js';

const ROOT    = dirname(dirname(fileURLToPath(import.meta.url)));
const DB_PATH = resolve(ROOT, process.env.DB_PATH || './data/wingman.db');

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

// ── Initialize sql.js ─────────────────────────────────────────────────────────

const SQL  = await initSqlJs();
const data = existsSync(DB_PATH) ? readFileSync(DB_PATH) : null;
const db   = data ? new SQL.Database(data) : new SQL.Database();

function persist() {
  writeFileSync(DB_PATH, db.export());
}

// ── Schema ────────────────────────────────────────────────────────────────────

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    discord_id   TEXT PRIMARY KEY,
    username     TEXT NOT NULL,
    cv_text      TEXT,
    preferences  TEXT DEFAULT '{}',
    gmail_refresh_token TEXT,
    created_at   INTEGER DEFAULT (strftime('%s','now')),
    updated_at   INTEGER DEFAULT (strftime('%s','now'))
  );
`);

try { db.run("ALTER TABLE users ADD COLUMN gmail_refresh_token TEXT;"); } catch(e) {}

try { db.run("ALTER TABLE applications ADD COLUMN jd_snippet TEXT;"); } catch(e) {}
try { db.run("ALTER TABLE applications ADD COLUMN report_text TEXT;"); } catch(e) {}
try { db.run("ALTER TABLE applications ADD COLUMN stories_json TEXT;"); } catch(e) {}
try { db.run("ALTER TABLE applications ADD COLUMN thread_id TEXT;"); } catch(e) {}

db.run(`
  CREATE TABLE IF NOT EXISTS applications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id   TEXT NOT NULL,
    company      TEXT,
    role         TEXT,
    score        REAL,
    archetype    TEXT,
    legitimacy   TEXT,
    status       TEXT DEFAULT 'Evaluated',
    jd_snippet   TEXT,
    report_text  TEXT,
    stories_json TEXT,
    thread_id    TEXT,
    evaluated_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS stories (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id   TEXT NOT NULL,
    title        TEXT NOT NULL,
    category     TEXT, -- e.g., Leadership, Technical, Conflict
    story_text   TEXT NOT NULL, -- STAR+R format
    created_at   INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS pipeline_queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id   TEXT NOT NULL,
    url          TEXT NOT NULL,
    status       TEXT DEFAULT 'pending', -- pending, processing, completed, failed
    notes        TEXT,
    error        TEXT,
    created_at   INTEGER DEFAULT (strftime('%s','now')),
    updated_at   INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_applications_discord_id
    ON applications(discord_id);
`);
persist();

// ── Helpers ───────────────────────────────────────────────────────────────────

function queryAll(sql, params = []) {
  const stmt   = db.prepare(sql);
  const rows   = [];
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
    log.info('DB Persistent update success', { sql: sql.slice(0, 50) });
  } catch (err) {
    log.error('DB Run failed', { error: err.message, sql });
  }
}

// ── User helpers ──────────────────────────────────────────────────────────────

export function getUser(discordId) {
  const row = queryOne('SELECT * FROM users WHERE discord_id = ?', [discordId]);
  if (!row) return null;
  return { ...row, preferences: JSON.parse(row.preferences || '{}') };
}

export function upsertUser(discordId, username) {
  run(`
    INSERT INTO users (discord_id, username)
    VALUES (?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      username   = excluded.username,
      updated_at = strftime('%s','now')
  `, [discordId, username]);
}

export function setCV(discordId, cvText) {
  run(`
    UPDATE users SET cv_text = ?, updated_at = strftime('%s','now')
    WHERE discord_id = ?
  `, [cvText, discordId]);
}

export function deleteCV(discordId) {
  run(`
    UPDATE users SET cv_text = NULL, updated_at = strftime('%s','now')
    WHERE discord_id = ?
  `, [discordId]);
}

export function getCV(discordId) {
  const row = queryOne('SELECT cv_text FROM users WHERE discord_id = ?', [discordId]);
  const hasCV = !!row?.cv_text;
  log.info('getCV lookup', { discordId, found: hasCV, length: row?.cv_text?.length || 0 });
  return row?.cv_text || null;
}

export function saveGmailToken(discordId, token) {
  run('UPDATE users SET gmail_refresh_token = ? WHERE discord_id = ?', [token, discordId]);
}

export function getGmailToken(discordId) {
  const row = queryOne('SELECT gmail_refresh_token FROM users WHERE discord_id = ?', [discordId]);
  return row?.gmail_refresh_token || null;
}

// ── Application tracker helpers ───────────────────────────────────────────────

export function saveApplication({ discordId, company, role, score, archetype, legitimacy, jdSnippet, reportText, storiesJson, threadId }) {
  run(`
    INSERT INTO applications
      (discord_id, company, role, score, archetype, legitimacy, jd_snippet, report_text, stories_json, thread_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [discordId, company, role, score, archetype, legitimacy, jdSnippet, reportText, storiesJson, threadId]);

  const row = queryOne('SELECT last_insert_rowid() AS id');
  return row?.id;
}

export function getApplication(id) {
  return queryOne('SELECT * FROM applications WHERE id = ?', [id]);
}

export function updateApplicationThread(id, threadId) {
  run('UPDATE applications SET thread_id = ? WHERE id = ?', [threadId, id]);
}

export function getUserApplications(discordId, limit = 10) {
  return queryAll(`
    SELECT id, company, role, score, archetype, legitimacy, status, evaluated_at
    FROM applications
    WHERE discord_id = ?
    ORDER BY evaluated_at DESC
    LIMIT ?
  `, [discordId, limit]);
}

export function updateApplicationStatus(id, discordId, status) {
  // Check ownership first
  const existing = queryOne(
    'SELECT id FROM applications WHERE id = ? AND discord_id = ?',
    [id, discordId],
  );
  if (!existing) return false;
  run('UPDATE applications SET status = ? WHERE id = ?', [status, id]);
  return true;
}

// ── Story Bank helpers ────────────────────────────────────────────────────────

export function addStory(discordId, title, category, storyText) {
  run(`
    INSERT INTO stories (discord_id, title, category, story_text)
    VALUES (?, ?, ?, ?)
  `, [discordId, title, category, storyText]);
}

export function getStories(discordId) {
  return queryAll('SELECT * FROM stories WHERE discord_id = ? ORDER BY created_at DESC', [discordId]);
}

export function deleteStory(id, discordId) {
  run('DELETE FROM stories WHERE id = ? AND discord_id = ?', [id, discordId]);
}

// ── Pipeline helpers ─────────────────────────────────────────────────────────

export function addToPipeline(discordId, url, notes = '') {
  run(`
    INSERT INTO pipeline_queue (discord_id, url, notes)
    VALUES (?, ?, ?)
  `, [discordId, url, notes]);
}

export function getPendingPipeline() {
  return queryAll("SELECT * FROM pipeline_queue WHERE status = 'pending' LIMIT 5");
}

export function updatePipelineStatus(id, status, error = null) {
  run(`
    UPDATE pipeline_queue 
    SET status = ?, error = ?, updated_at = strftime('%s','now')
    WHERE id = ?
  `, [status, error, id]);
}

/**
 * Get all users who have a Gmail refresh token (for scouting).
 */
export function getUsersWithGmail() {
  return queryAll('SELECT discord_id, username FROM users WHERE gmail_refresh_token IS NOT NULL');
}

export default db;
