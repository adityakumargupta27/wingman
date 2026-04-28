/**
 * lib/prompt-router.js — Intent classification and prompt routing
 *
 * Deterministic pattern matching + fuzzy intent classification.
 * Maps user input to the correct prompt module without LLM overhead.
 *
 * Priority: exact command match → URL pattern → keyword heuristic → fallback to chat
 */

import log from './logger.js';

// ── Route Definitions ─────────────────────────────────────────────────────────
// Each route has: patterns (regex), keywords (fuzzy), and the module to invoke.

const ROUTES = [
  {
    id: 'evaluate',
    command: /^\/(evaluate|eval)/i,
    urlPatterns: [
      /lever\.co/i, /greenhouse\.io/i, /careers\./i, /jobs\./i,
      /linkedin\.com\/jobs/i, /indeed\.com/i, /naukri\.com/i,
      /wellfound\.com/i, /internshala\.com/i, /unstop\.com/i,
      /angel\.co/i, /workatastartup/i,
    ],
    keywords: ['evaluate', 'score this', 'is this worth', 'should i apply', 'rate this job'],
    module: 'evaluate',
    description: 'Job evaluation against CV',
  },
  {
    id: 'project',
    command: /^\/(project|proj)/i,
    urlPatterns: [/github\.com\/[^/]+\/[^/]+/i, /gitlab\.com/i, /bitbucket\.org/i],
    keywords: ['project', 'analyze my project', 'project dna', 'github', 'portfolio'],
    module: 'project',
    description: 'Project DNA analysis',
  },
  {
    id: 'deep',
    command: /^\/(deep|research|company)/i,
    keywords: ['research', 'tell me about', 'company research', 'what do you know about', 'is .* a good company'],
    module: 'deep',
    description: 'Company intelligence report',
  },
  {
    id: 'tailor',
    command: /^\/(tailor|cv\s+tailor)/i,
    keywords: ['tailor', 'rewrite resume', 'ats', 'optimize cv', 'fix resume for'],
    module: 'tailor',
    description: 'ATS resume tailoring',
  },
  {
    id: 'interview',
    command: /^\/(interview|prep|mock)/i,
    keywords: ['interview', 'mock interview', 'prep me', 'practice questions', 'behavioral questions'],
    module: 'interview',
    description: 'Interview question generation',
  },
  {
    id: 'training',
    command: /^\/(training|learn|roadmap|gap)/i,
    keywords: ['what should i learn', 'skill gap', 'roadmap', 'upskill', 'how to prepare'],
    module: 'training',
    description: 'Skill gap analysis + roadmap',
  },
  {
    id: 'negotiate',
    command: /^\/(negotiate|offer)/i,
    keywords: ['negotiate', 'salary negotiation', 'counter offer', 'how much should i ask'],
    module: 'negotiate',
    description: 'Offer negotiation strategy',
  },
  {
    id: 'scan',
    command: /^\/(scan|find|search|jobs)/i,
    keywords: ['find jobs', 'job search', 'opportunities', 'where should i apply', 'hunt'],
    module: 'scan',
    description: 'Opportunity discovery',
  },
  {
    id: 'recruiter',
    command: /^\/(recruiter|review)/i,
    keywords: ['how does my resume look', 'recruiter view', 'would a recruiter', 'review my cv'],
    module: 'recruiter',
    description: 'Recruiter perspective analysis',
  },
  {
    id: 'startup',
    command: /^\/(startup|enterprise)/i,
    keywords: ['should i join', 'startup vs', 'startup or', 'is this startup worth'],
    module: 'startup',
    description: 'Startup vs enterprise decision',
  },
  {
    id: 'salary',
    command: /^\/(salary|pay|compensation|benchmark)/i,
    keywords: ['how much', 'salary range', 'market rate', 'compensation', 'pay for'],
    module: 'salary',
    description: 'Salary benchmarking',
  },
  {
    id: 'tracker',
    command: /^\/(tracker|track|status)/i,
    keywords: ['my applications', 'tracking', 'pipeline'],
    module: 'tracker',
    description: 'Application tracker',
  },
];

/**
 * Classify user intent and return the best matching route.
 *
 * @param {string} text - User's raw input
 * @returns {{ route: object, confidence: 'exact'|'url'|'keyword'|'fallback', extractedData: object }}
 */
export function classifyIntent(text) {
  if (!text || typeof text !== 'string') {
    return { route: null, confidence: 'fallback', extractedData: {} };
  }

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // 1. EXACT COMMAND MATCH (highest confidence)
  for (const route of ROUTES) {
    if (route.command && route.command.test(trimmed)) {
      const payload = trimmed.replace(route.command, '').trim();
      log.debug('Route: exact command match', { id: route.id, payload: payload.slice(0, 50) });
      return { route, confidence: 'exact', extractedData: { payload } };
    }
  }

  // 2. URL PATTERN MATCH
  const urlMatch = trimmed.match(/https?:\/\/[^\s]+/);
  if (urlMatch) {
    const url = urlMatch[0];
    for (const route of ROUTES) {
      if (route.urlPatterns) {
        for (const pattern of route.urlPatterns) {
          if (pattern.test(url)) {
            log.debug('Route: URL pattern match', { id: route.id, url: url.slice(0, 80) });
            return { route, confidence: 'url', extractedData: { url, payload: trimmed } };
          }
        }
      }
    }
    // Unknown URL — default to evaluate (job link assumption)
    const evalRoute = ROUTES.find(r => r.id === 'evaluate');
    return { route: evalRoute, confidence: 'url', extractedData: { url, payload: trimmed } };
  }

  // 3. KEYWORD HEURISTIC (lower confidence)
  for (const route of ROUTES) {
    if (route.keywords) {
      for (const kw of route.keywords) {
        if (lower.includes(kw) || new RegExp(kw, 'i').test(lower)) {
          log.debug('Route: keyword match', { id: route.id, keyword: kw });
          return { route, confidence: 'keyword', extractedData: { payload: trimmed } };
        }
      }
    }
  }

  // 4. FALLBACK — conversational chat
  return { route: null, confidence: 'fallback', extractedData: { payload: trimmed } };
}

/**
 * Get a route by its ID.
 */
export function getRoute(id) {
  return ROUTES.find(r => r.id === id) || null;
}

/**
 * List all available routes (for help commands).
 */
export function listRoutes() {
  return ROUTES.map(r => ({ id: r.id, description: r.description }));
}

export { ROUTES };
