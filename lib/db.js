/**
 * lib/db.js — SQLite database helpers for SME Bot (using sql.js)
 *
 * Uses sql.js (pure JS/WASM) — no native compilation required.
 * Data is persisted to disk by writing the DB file after mutations.
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT    = dirname(dirname(fileURLToPath(import.meta.url)));
const DB_PATH = resolve(ROOT, process.env.DB_PATH || './data/sme-bot.db');

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
    created_at   INTEGER DEFAULT (strftime('%s','now')),
    updated_at   INTEGER DEFAULT (strftime('%s','now'))
  );

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
    thread_id    TEXT,
    evaluated_at INTEGER DEFAULT (strftime('%s','now'))
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
  db.run(sql, params);
  persist();
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
  return row?.cv_text || null;
}

// ── Application tracker helpers ───────────────────────────────────────────────

export function saveApplication({ discordId, company, role, score, archetype, legitimacy, jdSnippet, reportText, threadId }) {
  run(`
    INSERT INTO applications
      (discord_id, company, role, score, archetype, legitimacy, jd_snippet, report_text, thread_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [discordId, company, role, score, archetype, legitimacy, jdSnippet, reportText, threadId]);

  const row = queryOne('SELECT last_insert_rowid() AS id');
  return row?.id;
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

export default db;
