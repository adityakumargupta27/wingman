/**
 * lib/prompt-router.js — Intent classification and prompt routing
 *
 * Deterministic pattern matching + fuzzy intent classification.
 * Maps user input to the correct prompt module without LLM overhead.
 *
 * Priority: exact command match → URL pattern → keyword heuristic → fallback to chat
 */

import axios from 'axios';
import log from './logger.js';

// ── Configuration ────────────────────────────────────────────────────────────

const JOB_BOARDS = [
  'linkedin.com', 'indeed.com', 'wellfound.com', 'greenhouse.io', 'lever.co',
  'unstop.com', 'naukri.com', 'internshala.com', 'angel.co', 'workatastartup.com',
  'ashbyhq.com', 'smartrecruiters.com', 'breezy.hr', 'workable.com'
];

const PROJECT_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'];

const SHORTENERS = ['tinyurl.com', 'bit.ly', 't.co', 'rebrand.ly', 'is.gd'];

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
 * Now includes ASYNC redirect expansion for short URLs.
 *
 * @param {string} text - User's raw input
 * @returns {Promise<{ route: object, confidence: 'exact'|'url'|'keyword'|'fallback', extractedData: object }>}
 */
export async function classifyIntent(text) {
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

  // 2. URL CLASSIFICATION
  const urlMatch = trimmed.match(/https?:\/\/\S+/);
  if (urlMatch) {
    let url = urlMatch[0];
    let host = '';

    try {
      const urlObj = new URL(url);
      host = urlObj.hostname.replace('www.', '');

      // Redirect Expansion for shorteners
      if (SHORTENERS.some(s => host.includes(s))) {
        log.debug('URL: Shortener detected, expanding...', { host });
        const resp = await axios.head(url, { maxRedirects: 5, timeout: 3000, validateStatus: () => true });
        if (resp.request?.res?.responseUrl) {
          url = resp.request.res.responseUrl;
          host = new URL(url).hostname.replace('www.', '');
          log.debug('URL: Expanded', { url, host });
        }
      }

      // Route: GitHub/Projects
      if (PROJECT_HOSTS.some(p => host.includes(p))) {
        return { 
          route: ROUTES.find(r => r.id === 'project'), 
          confidence: 'url', 
          extractedData: { url, payload: trimmed } 
        };
      }

      // Route: LinkedIn (Profile vs Job)
      if (host.includes('linkedin.com')) {
        if (url.includes('/jobs/')) {
          return { 
            route: ROUTES.find(r => r.id === 'evaluate'), 
            confidence: 'url', 
            extractedData: { url, payload: trimmed } 
          };
        }
        // LinkedIn Profile -> Conversational/Research
        return { 
          route: null, 
          confidence: 'keyword', 
          extractedData: { payload: `Analyze this LinkedIn profile: ${url}` } 
        };
      }

      // Route: Known Job Boards
      if (JOB_BOARDS.some(d => host.includes(d))) {
        return { 
          route: ROUTES.find(r => r.id === 'evaluate'), 
          confidence: 'url', 
          extractedData: { url, payload: trimmed } 
        };
      }

      // Default URL: Generic analysis
      return { 
        route: null, 
        confidence: 'keyword', 
        extractedData: { payload: `Analyze this website/opportunity: ${url}` } 
      };

    } catch (e) {
      log.warn('URL classification failed', { error: e.message });
    }
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
