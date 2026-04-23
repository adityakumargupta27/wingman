/**
 * lib/gemini.js — Gemini API wrapper for SME Bot
 *
 * Wraps @google/generative-ai for job evaluation, company research,
 * and interview prep. Mirrors the pattern from career-ops/gemini-eval.mjs.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('❌  GEMINI_API_KEY not set. Add it to your .env file.');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const MAX_TOKENS    = parseInt(process.env.GEMINI_MAX_TOKENS || '8192');

/**
 * Call Gemini with a system prompt and user content.
 * @param {string} systemPrompt - The system/context prompt
 * @param {string} userContent  - The user's content (JD text, question, etc.)
 * @param {string} [modelName]  - Override model name
 * @returns {Promise<string>}   - Gemini's response text
 */
export async function callGemini(systemPrompt, userContent, modelName = DEFAULT_MODEL) {
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: MAX_TOKENS,
    },
  });

  const result = await model.generateContent([
    { text: systemPrompt },
    { text: userContent },
  ]);

  return result.response.text();
}

/**
 * Evaluate a job description against a CV.
 * @param {object} params
 * @param {string} params.systemPrompt - Built by prompt-engine.js
 * @param {string} params.jdText       - Full job description text
 * @returns {Promise<string>}
 */
export async function evaluateJD({ systemPrompt, jdText }) {
  const MAX_JD_CHARS = 30_000;
  const truncated = jdText.length > MAX_JD_CHARS
    ? jdText.slice(0, MAX_JD_CHARS) + '\n\n[JD truncated to 30k chars]'
    : jdText;

  return callGemini(systemPrompt, `\n\nJOB DESCRIPTION TO EVALUATE:\n\n${truncated}`);
}

/**
 * Run a company deep-research query.
 */
export async function researchCompany({ systemPrompt, companyName }) {
  return callGemini(systemPrompt, `\n\nCOMPANY TO RESEARCH:\n\n${companyName}`);
}

/**
 * Generate interview questions for a role.
 */
export async function generateInterviewQuestions({ systemPrompt, role }) {
  return callGemini(systemPrompt, `\n\nROLE:\n\n${role}`);
}

export { DEFAULT_MODEL };
