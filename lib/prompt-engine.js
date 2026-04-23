/**
 * lib/prompt-engine.js — Build system prompts for SME Bot
 *
 * Loads modes/*.md files (career-ops evaluation logic) and constructs
 * structured system prompts for Gemini. Reads from ./modes/ by default,
 * configurable via MODES_PATH env var.
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT       = dirname(dirname(fileURLToPath(import.meta.url)));
const MODES_PATH = resolve(ROOT, process.env.MODES_PATH || './modes');

function readMode(filename, label) {
  const path = join(MODES_PATH, filename);
  if (!existsSync(path)) {
    console.warn(`⚠️  Mode file not found: ${path} — using fallback`);
    return `[${label} not available — using built-in fallback logic]`;
  }
  return readFileSync(path, 'utf-8').trim();
}

// ── Cached mode files ─────────────────────────────────────────────────────────
// Loaded once at startup to avoid repeated disk I/O per command.

let _shared   = null;
let _oferta   = null;
let _deep     = null;

function shared()  { return _shared  ||= readMode('_shared.md',  '_shared'); }
function oferta()  { return _oferta  ||= readMode('oferta.md',   'oferta'); }
function deepMode(){ return _deep    ||= readMode('deep.md',     'deep'); }

// ── Prompt builders ───────────────────────────────────────────────────────────

/**
 * Build the evaluation system prompt.
 * @param {string} cvText - User's CV text
 */
export function buildEvaluationPrompt(cvText) {
  return `You are SME Bot, a career intelligence assistant running inside Discord.
You evaluate job offers against the user's CV using a structured A-F scoring system.
Always respond in English regardless of the language of the job description.

════════════════════════════════════════════════════
SYSTEM CONTEXT (_shared.md)
════════════════════════════════════════════════════
${shared()}

════════════════════════════════════════════════════
EVALUATION MODE (oferta.md)
════════════════════════════════════════════════════
${oferta()}

════════════════════════════════════════════════════
CANDIDATE RESUME
════════════════════════════════════════════════════
${cvText || '[No CV on file — evaluate based on general criteria only]'}

════════════════════════════════════════════════════
DISCORD OUTPUT RULES
════════════════════════════════════════════════════
1. Format output as plain text with emoji headers — NO markdown tables.
2. Keep section headers short (< 80 chars each).
3. Limit each section to ~800 characters for Discord embed compatibility.
4. Always end with this exact machine-readable block:

---SCORE_SUMMARY---
COMPANY: <company name or "Unknown">
ROLE: <role title>
SCORE: <global score as decimal, e.g. 3.8>
ARCHETYPE: <detected archetype>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
---END_SUMMARY---`;
}

/**
 * Build the company deep-research prompt.
 */
export function buildDeepResearchPrompt() {
  return `You are SME Bot, a career intelligence assistant running inside Discord.
Research the given company thoroughly for a job seeker.
Always respond in English.

${deepMode()}

════════════════════════════════════════════════════
DISCORD OUTPUT RULES
════════════════════════════════════════════════════
1. Use plain text with emoji section headers.
2. Cover: company overview, culture, tech stack, funding/stability, interview process (if known), red flags.
3. Keep the total response under 2000 characters for Discord.`;
}

/**
 * Build the interview prep prompt.
 */
export function buildInterviewPrepPrompt(cvText) {
  return `You are SME Bot, a career intelligence assistant running inside Discord.
Generate targeted interview questions for a specific role, tailored to the candidate's background.
Always respond in English.

════════════════════════════════════════════════════
CANDIDATE RESUME
════════════════════════════════════════════════════
${cvText || '[No CV on file — generate general interview questions]'}

════════════════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════════════════
Generate exactly 10 interview questions:
- 3 behavioral (STAR format — based on CV gaps)
- 3 technical (based on common requirements for the role)
- 2 culture fit
- 2 questions the candidate should ask the interviewer

Format each as a numbered list with a brief hint on how to approach it.
Keep total response under 1800 characters.`;
}
