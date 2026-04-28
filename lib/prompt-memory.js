/**
 * lib/prompt-memory.js — User context injection layer
 *
 * Manages per-user context that gets injected into prompts.
 * Short-lived session cache with TTL expiration.
 * No secrets stored. No conversation history (stateless per-request).
 */

import { getUser, getCV, getUserApplications } from './db.js';
import log from './logger.js';

// ── Session Cache (TTL-based) ─────────────────────────────────────────────────
const sessionCache = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

// Cleanup stale sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessionCache) {
    if (now - session.lastAccess > SESSION_TTL) {
      sessionCache.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Build the full user context object for prompt injection.
 * Pulls from DB + session cache.
 *
 * @param {string} userId - User's platform ID
 * @returns {object} Context object with all available user data
 */
export function buildUserContext(userId) {
  // Check cache first
  const cached = sessionCache.get(userId);
  if (cached && Date.now() - cached.lastAccess < SESSION_TTL) {
    cached.lastAccess = Date.now();
    return cached.context;
  }

  // Build fresh context from DB
  const user = getUser(userId);
  const cvText = getCV(userId);
  const applications = getUserApplications(userId, 5);

  const context = {
    user_name: user?.username || 'User',
    cv_text: cvText || null,
    cv_available: !!cvText,
    cv_length: cvText?.length || 0,
    experience_level: inferExperienceLevel(cvText),
    skills: extractSkills(cvText),
    recent_applications: applications?.map(a => ({
      company: a.company,
      role: a.role,
      score: a.score,
      status: a.status,
    })) || [],
    application_count: applications?.length || 0,
    preferences: user?.preferences || {},
  };

  // Cache it
  sessionCache.set(userId, { context, lastAccess: Date.now() });

  return context;
}

/**
 * Inject user context variables into a prompt template.
 * Replaces {{variable}} placeholders with actual values.
 *
 * Security: All injected values are sanitized to prevent prompt injection.
 *
 * @param {string} template - Prompt template with {{placeholders}}
 * @param {object} context - User context from buildUserContext()
 * @param {object} [extra] - Additional variables to inject
 * @returns {string} Prompt with variables replaced
 */
export function injectContext(template, context, extra = {}) {
  const vars = { ...context, ...extra };
  let result = template;

  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{{${key}}}`;
    if (result.includes(placeholder)) {
      const sanitized = sanitizeForPrompt(String(value || ''));
      result = result.replaceAll(placeholder, sanitized);
    }
  }

  return result;
}

/**
 * Sanitize user-provided content before injecting into prompts.
 * Prevents prompt injection attacks.
 */
function sanitizeForPrompt(text) {
  if (!text) return '';

  return text
    // Remove common injection patterns
    .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?)/gi, '[FILTERED]')
    .replace(/you\s+are\s+now\s+/gi, '[FILTERED]')
    .replace(/system\s*:\s*/gi, '[FILTERED]')
    .replace(/\bAPI[_\s]?KEY\b/gi, '[FILTERED]')
    .replace(/\bpassword\b/gi, '[FILTERED]')
    // Limit length to prevent context stuffing
    .slice(0, 15000);
}

/**
 * Infer experience level from CV text.
 */
function inferExperienceLevel(cvText) {
  if (!cvText) return 'Unknown';

  const lower = cvText.toLowerCase();

  // Check for year indicators
  const yearMatches = lower.match(/(\d{4})\s*[-–]\s*(present|\d{4})/gi) || [];
  const currentYear = new Date().getFullYear();
  let maxYears = 0;

  for (const match of yearMatches) {
    const years = match.match(/(\d{4})/g);
    if (years && years.length >= 1) {
      const start = parseInt(years[0]);
      const end = years[1] === 'present' ? currentYear : parseInt(years[1] || currentYear);
      maxYears = Math.max(maxYears, end - start);
    }
  }

  if (lower.includes('intern') || lower.includes('student') || maxYears <= 1) return 'Entry/Intern';
  if (maxYears <= 3) return 'Junior';
  if (maxYears <= 6) return 'Mid';
  if (maxYears <= 10) return 'Senior';
  return 'Staff+';
}

/**
 * Extract skill keywords from CV text (simple heuristic).
 */
function extractSkills(cvText) {
  if (!cvText) return [];

  const TECH_KEYWORDS = [
    'javascript', 'typescript', 'python', 'java', 'c++', 'go', 'rust', 'ruby',
    'react', 'vue', 'angular', 'next.js', 'node.js', 'express', 'django', 'flask',
    'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch',
    'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform',
    'machine learning', 'deep learning', 'nlp', 'computer vision',
    'pytorch', 'tensorflow', 'langchain', 'openai',
    'git', 'ci/cd', 'linux', 'graphql', 'rest api',
    'figma', 'tailwind', 'sass', 'webpack', 'vite',
    'supabase', 'firebase', 'prisma', 'drizzle',
  ];

  const lower = cvText.toLowerCase();
  return TECH_KEYWORDS.filter(skill => lower.includes(skill));
}

/**
 * Clear a user's session cache.
 */
export function clearSession(userId) {
  sessionCache.delete(userId);
}
