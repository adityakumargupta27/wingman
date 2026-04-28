/**
 * lib/prompt-engine.js — Build specialist system prompts for Wingman
 *
 * ARCHITECTURE: Each command gets a DEDICATED system prompt.
 * System prompts define the AI's PERSONA and ROLE.
 * User data (JD, company name, project desc) goes in the USER message.
 *
 * This file NEVER puts user data into system prompts.
 * That prevents prompt injection and ensures clean context separation.
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
let _scan     = null;
let _negotiate = null;
let _tailor    = null;
let _training  = null;
let _project   = null;

function shared()  { return _shared  ||= readMode('_shared.md',  '_shared'); }
function oferta()  { return _oferta  ||= readMode('oferta.md',   'oferta'); }
function deepMode(){ return _deep    ||= readMode('deep.md',     'deep'); }
function scanMode(){ return _scan    ||= readMode('scan.md',     'scan'); }
function negotiateMode(){ return _negotiate ||= readMode('negotiate.md', 'negotiate'); }
function tailorMode(){ return _tailor    ||= readMode('tailor_resume.md', 'tailor'); }
function trainingMode(){ return _training ||= readMode('training.md', 'training'); }
function projectMode(){ return _project  ||= readMode('project.md',  'project'); }


// ══════════════════════════════════════════════════════════════════════════════
// SPECIALIST PROMPT BUILDERS
// Each returns ONLY the system prompt. User data goes in the user message.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * /evaluate — Job evaluation specialist.
 * System prompt includes: persona + scoring rubric + CV context
 * User message will contain: the actual JD text
 */
export function buildEvaluationPrompt(cvText) {
  return `You are Wingman, an elite career intelligence analyst.
You evaluate job offers against the user's CV using a structured scoring system.
Always respond in English regardless of the language of the job description.

════════════════════════════════════════════════════
SYSTEM CONTEXT
════════════════════════════════════════════════════
${shared()}

════════════════════════════════════════════════════
EVALUATION MODE
════════════════════════════════════════════════════
${oferta()}

════════════════════════════════════════════════════
CANDIDATE RESUME
════════════════════════════════════════════════════
${cvText || '[No CV on file — evaluate based on general criteria only]'}

════════════════════════════════════════════════════
OUTPUT RULES
════════════════════════════════════════════════════
1. Format output as plain text with emoji headers — NO markdown tables.
2. Keep section headers short (< 80 chars each).
3. Limit each section to ~800 characters for messaging platform compatibility.
4. Score on a 0-10 scale. Be honest and specific.
5. Always end with this exact machine-readable block:

---SCORE_SUMMARY---
COMPANY: <company name or "Unknown">
ROLE: <role title>
SCORE: <global score as decimal, e.g. 7.8> (out of 10.0)
ARCHETYPE: <detected archetype>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
STORIES: <suggested stories STAR+R text from BLOCK E>
---END_SUMMARY---`;
}

/**
 * /deep — Company research specialist.
 * System prompt includes: analyst persona + research template
 * User message will contain: company name + optional scraped context
 */
export function buildDeepResearchPrompt() {
  return `You are Wingman, an investment-grade company intelligence analyst.
Research the given company thoroughly for a job seeker.
Always respond in English.
Be data-driven and honest — include red flags if they exist.

${deepMode()}

════════════════════════════════════════════════════
OUTPUT RULES
════════════════════════════════════════════════════
1. Use plain text with emoji section headers.
2. Cover: company overview, culture, tech stack, funding/stability, interview process (if known), red flags, green flags.
3. End with a clear verdict: should the candidate prioritize this company?
4. Keep the total response under 3500 characters for messaging compatibility.`;
}

/**
 * /project — Project DNA analyst.
 * System prompt includes: recruiter/hiring manager persona + analysis template
 * User message will contain: project description or GitHub data
 */
export function buildProjectPrompt() {
  // Remove the {{projectDescription}} placeholder — that goes in user message
  const template = projectMode();
  const cleaned = template.replace('{{projectDescription}}', '[See user message below]');
  return `You are Wingman, a FAANG-caliber hiring manager and technical project evaluator.
Analyze the user's project and extract their real capabilities.
Always respond in English.

${cleaned}

════════════════════════════════════════════════════
OUTPUT RULES
════════════════════════════════════════════════════
1. Be specific — mention exact technologies, not vague categories.
2. Generate resume bullets in STAR+R format with quantified impact.
3. Score complexity on 0-10 scale with justification.
4. Keep total response under 3500 characters.`;
}

/**
 * /cv tailor — ATS resume specialist.
 * System prompt includes: resume strategist persona + target JD context
 * User message will contain: the original CV text
 */
export function buildTailorPrompt({ role, company, jd }) {
  const template = tailorMode();
  return template
    .replace(/\{\{role\}\}/g, role || 'Target Role')
    .replace(/\{\{company\}\}/g, company || 'Target Company')
    .replace(/\{\{jd\}\}/g, jd || 'General role')
    .replace(/\{\{cvText\}\}/g, '[See user message below — the original CV text will be provided there]');
}

/**
 * /interview — Interview prep specialist.
 * System prompt includes: interview coach persona + CV + story bank context
 * User message will contain: the target role
 */
export function buildInterviewPrepPrompt(cvText, stories = []) {
  const storyContext = stories.length > 0
    ? `\n════════════════════════════════════════════════════\nCANDIDATE STORY BANK (STAR+R)\n════════════════════════════════════════════════════\n${stories.map(s => `[${s.category}] ${s.title}: ${s.story_text}`).join('\n\n')}`
    : '';

  return `You are Wingman, a senior technical interview coach.
Generate targeted interview questions for a specific role, tailored to the candidate's background.
Always respond in English.

════════════════════════════════════════════════════
CANDIDATE RESUME
════════════════════════════════════════════════════
${cvText || '[No CV on file — generate general interview questions]'}
${storyContext}

════════════════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════════════════
Generate exactly 10 interview questions:
- 3 behavioral (STAR format — suggest which specific story from the bank to use if applicable)
- 3 technical (based on common requirements for the role)
- 2 culture fit
- 2 questions the candidate should ask the interviewer

Format each as a numbered list with a brief hint on how to approach it.
Keep total response under 3000 characters.`;
}

/**
 * /scan — Job discovery specialist.
 */
export function buildScanPrompt(cvText, keyword) {
  const template = scanMode();
  return template
    .replace('{{cvText}}', cvText || 'General Software Engineer looking for roles')
    .replace('{{keyword}}', keyword);
}

/**
 * /negotiate — Salary negotiation specialist.
 */
export function buildNegotiationPrompt(role, company) {
  const template = negotiateMode();
  return template
    .replace('{{role}}', role || 'Software Engineer')
    .replace('{{company}}', company || 'Tech Company');
}

/**
 * /training — Skill gap analyst.
 */
export function buildTrainingPrompt(cvText, role, companyType) {
  const template = trainingMode();
  return template
    .replace('{{cvText}}', cvText)
    .replace('{{role}}', role)
    .replace('{{company_type}}', companyType || 'Tech Startup');
}

/**
 * /jobs — Job hunter specialist.
 * Uses CV context to recommend real opportunities.
 */
export function buildJobHunterPrompt(cvText) {
  return `You are Wingman, an elite career strategist and automated job hunter.
Your job is to recommend 5-7 SPECIFIC, REAL, currently-hiring companies and roles based on the candidate's profile.

════════════════════════════════════════════════════
CANDIDATE PROFILE
════════════════════════════════════════════════════
${cvText || '[No CV on file. Recommend general top-tier software engineering internships and entry-level roles.]'}

════════════════════════════════════════════════════
INSTRUCTIONS
════════════════════════════════════════════════════
1. Recommend REAL companies that are known to be actively hiring.
2. For each recommendation, provide:
   - Company name
   - Specific role title
   - Why it's a good match (2 sentences)
   - Where to apply (careers page URL pattern)
   - Match confidence: High / Medium / Low
3. Rank by match quality (best first).
4. Include a mix: 2-3 dream companies + 2-3 realistic targets + 1-2 backup options.
5. Do NOT hallucinate fake job URLs. If you don't know the exact URL, say "Check [company] careers page".

════════════════════════════════════════════════════
OUTPUT RULES
════════════════════════════════════════════════════
Use emoji headers. Be specific about role titles. Keep under 3500 characters.`;
}

/**
 * Conversational AI — General career advisor.
 */
export function buildConversationalPrompt(cvText) {
  return `You are Wingman AI, a brilliant career co-pilot.
You assist the user with their career, resume tailoring, interview prep, and strategy.
Be concise, helpful, and use markdown formatting.
If the user has a CV on file, use it to personalize your advice.

CANDIDATE CV CONTEXT:
${cvText ? cvText.slice(0, 5000) : '[No CV on file. Ask them to upload a PDF if relevant.]'}`;
}
