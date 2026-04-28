/**
 * lib/prompt-validator.js — Output validation and JSON repair
 *
 * Validates AI responses against expected schemas.
 * Attempts to repair malformed JSON before failing.
 */

import log from './logger.js';

/**
 * Extract and parse JSON from an AI response.
 * Handles common issues: markdown wrappers, trailing commas, truncation.
 *
 * @param {string} text - Raw AI response
 * @returns {{ data: object|null, error: string|null }}
 */
export function extractJSON(text) {
  if (!text) return { data: null, error: 'Empty response' };

  // 1. Try direct parse
  try {
    return { data: JSON.parse(text), error: null };
  } catch {}

  // 2. Strip markdown code block wrapper
  let cleaned = text;
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) cleaned = codeBlock[1].trim();

  try {
    return { data: JSON.parse(cleaned), error: null };
  } catch {}

  // 3. Extract JSON object or array pattern
  const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      return { data: JSON.parse(jsonMatch[1]), error: null };
    } catch {}

    // 4. Attempt repair: trailing commas
    let repaired = jsonMatch[1]
      .replace(/,\s*}/g, '}')
      .replace(/,\s*\]/g, ']');

    try {
      return { data: JSON.parse(repaired), error: null };
    } catch {}

    // 5. Attempt repair: truncated JSON (add closing brackets)
    const openBraces = (repaired.match(/{/g) || []).length;
    const closeBraces = (repaired.match(/}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;

    repaired += '}'.repeat(Math.max(0, openBraces - closeBraces));
    repaired += ']'.repeat(Math.max(0, openBrackets - closeBrackets));

    try {
      return { data: JSON.parse(repaired), error: null };
    } catch (err) {
      log.warn('JSON repair failed', { error: err.message, preview: repaired.slice(0, 200) });
    }
  }

  return { data: null, error: 'Could not extract valid JSON from response' };
}

/**
 * Validate a parsed resume JSON against the tailor schema.
 */
export function validateResumeJSON(data) {
  const errors = [];

  if (!data.name) errors.push('Missing: name');
  if (!data.summary) errors.push('Missing: summary');
  if (!data.skills) errors.push('Missing: skills');
  if (!Array.isArray(data.projects)) errors.push('Missing or invalid: projects array');
  if (!Array.isArray(data.experience)) errors.push('Missing or invalid: experience array');

  if (data.projects?.length > 0) {
    for (const p of data.projects) {
      if (!p.name) errors.push('Project missing name');
      if (!Array.isArray(p.bullets) || p.bullets.length === 0) errors.push(`Project "${p.name}" has no bullets`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that a SCORE_SUMMARY block exists and parses correctly.
 */
export function validateScoreSummary(text) {
  const hasBlock = /---SCORE_SUMMARY---[\s\S]*---END_SUMMARY---/.test(text);
  if (!hasBlock) return { valid: false, error: 'Missing ---SCORE_SUMMARY--- block' };

  const match = text.match(/SCORE:\s*(\d+\.?\d*)/);
  if (!match) return { valid: false, error: 'Could not parse SCORE from summary block' };

  const score = parseFloat(match[1]);
  if (isNaN(score) || score < 0 || score > 10) {
    return { valid: false, error: `Score out of range: ${score}` };
  }

  return { valid: true, score };
}

/**
 * Validate scan/opportunity JSON array output.
 */
export function validateScanJSON(data) {
  if (!Array.isArray(data)) return { valid: false, error: 'Expected JSON array' };
  if (data.length === 0) return { valid: false, error: 'Empty results array' };

  const errors = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item.company) errors.push(`Item ${i}: missing company`);
    if (!item.role) errors.push(`Item ${i}: missing role`);
    if (typeof item.match_score !== 'number') errors.push(`Item ${i}: missing/invalid match_score`);
  }

  return { valid: errors.length === 0, errors };
}
