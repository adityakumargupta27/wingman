/**
 * lib/score-parser.js — Parse AI's ---SCORE_SUMMARY--- block
 *
 * Extracts structured data from evaluation output.
 * Standardized to 10.0 scale throughout.
 * Falls back gracefully if the block is missing.
 */

/**
 * Parse the machine-readable score summary block from an evaluation.
 * @param {string} text - Full AI response text
 * @returns {{ company, role, score, archetype, legitimacy, stories, rawReport }}
 */
export function parseScore(text) {
  const match = text.match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);

  let company    = 'Unknown';
  let role       = 'Unknown Role';
  let score      = null;
  let archetype  = 'Unknown';
  let legitimacy = 'Unknown';
  let stories    = null;

  if (match) {
    const block = match[1];
    const extract = (key) => {
      const m = block.match(new RegExp(`${key}:\\s*(.+)`));
      return m ? m[1].trim() : null;
    };
    company    = extract('COMPANY')    || company;
    role       = extract('ROLE')       || role;
    archetype  = extract('ARCHETYPE')  || archetype;
    legitimacy = extract('LEGITIMACY') || legitimacy;
    stories    = extract('STORIES')    || stories;
    const rawScore = extract('SCORE');
    if (rawScore) {
      // Extract just the number, handling formats like "7.8 (out of 10.0)" or "7.8/10"
      const numMatch = rawScore.match(/(\d+\.?\d*)/);
      score = numMatch ? parseFloat(numMatch[1]) : null;
    }
  }

  // Strip the summary block from the report text
  const rawReport = text.replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/, '').trim();

  return { company, role, score, archetype, legitimacy, stories, rawReport };
}

/**
 * Get a score emoji representation.
 * @param {number|null} score - Score 0-10
 */
export function scoreEmoji(score) {
  if (score === null) return '❓';
  if (score >= 9.0) return '🌟';
  if (score >= 8.0) return '✅';
  if (score >= 7.0) return '👍';
  if (score >= 6.0) return '⚠️';
  if (score >= 4.0) return '👎';
  return '❌';
}

/**
 * Get a score bar (10-char visual).
 * @param {number|null} score - Score 0-10
 */
export function scoreBar(score) {
  if (score === null) return '░░░░░░░░░░';
  const filled = Math.round(score);
  const safeFilled = Math.max(0, Math.min(10, filled));
  return '█'.repeat(safeFilled) + '░'.repeat(10 - safeFilled);
}

/**
 * Get a recommendation string.
 * @param {number|null} score - Score 0-10
 */
export function recommendation(score) {
  if (score === null) return '⚪ Review manually';
  if (score >= 8.0) return '🟢 APPLY — Strong match';
  if (score >= 7.0) return '🟡 CONSIDER — Review gaps';
  if (score >= 5.0) return '🟠 BORDERLINE — Significant gaps';
  return '🔴 PASS — Below threshold';
}
