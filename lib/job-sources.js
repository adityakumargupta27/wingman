/**
 * lib/job-sources.js — Job Ingestion Engine
 *
 * Fetches real jobs from public ATS APIs:
 *   - Greenhouse boards API (free, no auth)
 *   - Lever postings API (free, no auth)
 *   - Ashby boards API (free, no auth)
 *
 * Each source returns normalized JobRaw objects.
 * Runs on a configurable schedule via startIngestion().
 */

import log from './logger.js';

// ── Target Companies ─────────────────────────────────────────────────────────
// Curated list of companies with public ATS boards.
// These are REAL, verified board slugs.

const GREENHOUSE_BOARDS = [
  'stripe', 'cloudflare', 'figma', 'notion', 'airtable',
  'coinbase', 'databricks', 'brex', 'ramp', 'plaid',
  'gitlab', 'hashicorp', 'datadog', 'snyk', 'twilio',
  'duolingo', 'affirm', 'gusto', 'grammarly', 'canva',
  'postman', 'razorpay', 'cred', 'zerodha', 'meesho',
  'swiggy', 'zomato', 'groww', 'slice', 'jupiter',
];

const LEVER_ACCOUNTS = [
  'netflix', 'lever', 'spotify', 'reddit',
  'yelp', 'wealthsimple', 'faire', 'whatnot',
  'chime', 'vanta', 'onepassword',
];

const ASHBY_BOARDS = [
  'ramp', 'linear', 'vercel', 'cal',
  'retool', 'replit', 'supabase',
];

// ── Fetch Functions ──────────────────────────────────────────────────────────

const FETCH_TIMEOUT = 15_000;

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Fetch all jobs from a Greenhouse board.
 */
async function fetchGreenhouseBoard(boardSlug) {
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${boardSlug}/jobs?content=true`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];

    const data = await res.json();
    return (data.jobs || []).map(j => ({
      source: 'greenhouse',
      source_id: `gh_${boardSlug}_${j.id}`,
      company: boardSlug.charAt(0).toUpperCase() + boardSlug.slice(1),
      title: j.title,
      location: j.location?.name || 'Unknown',
      url: j.absolute_url,
      description: stripHtml(j.content || ''),
      skills: extractSkillsFromJD(j.content || ''),
      experience_min: inferMinExperience(j.title, j.content || ''),
      experience_max: inferMaxExperience(j.title, j.content || ''),
      employment_type: inferEmploymentType(j.title),
      posted_at: j.updated_at || new Date().toISOString(),
    }));
  } catch (err) {
    log.warn(`Greenhouse fetch failed: ${boardSlug}`, { error: err.message });
    return [];
  }
}

/**
 * Fetch all jobs from a Lever board.
 */
async function fetchLeverBoard(account) {
  try {
    const url = `https://api.lever.co/v0/postings/${account}?mode=json`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];

    const data = await res.json();
    return (data || []).map(j => ({
      source: 'lever',
      source_id: `lv_${account}_${j.id}`,
      company: account.charAt(0).toUpperCase() + account.slice(1),
      title: j.text,
      location: j.categories?.location || 'Unknown',
      url: j.hostedUrl,
      description: stripHtml(j.descriptionPlain || j.description || ''),
      skills: extractSkillsFromJD(j.descriptionPlain || j.description || ''),
      experience_min: inferMinExperience(j.text, j.descriptionPlain || ''),
      experience_max: inferMaxExperience(j.text, j.descriptionPlain || ''),
      employment_type: inferEmploymentType(j.text),
      posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : new Date().toISOString(),
    }));
  } catch (err) {
    log.warn(`Lever fetch failed: ${account}`, { error: err.message });
    return [];
  }
}

/**
 * Fetch all jobs from an Ashby board.
 */
async function fetchAshbyBoard(orgSlug) {
  try {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${orgSlug}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];

    const data = await res.json();
    return (data.jobs || []).map(j => ({
      source: 'ashby',
      source_id: `ash_${orgSlug}_${j.id}`,
      company: orgSlug.charAt(0).toUpperCase() + orgSlug.slice(1),
      title: j.title,
      location: j.location || 'Unknown',
      url: j.jobUrl || `https://jobs.ashbyhq.com/${orgSlug}/${j.id}`,
      description: stripHtml(j.descriptionHtml || j.descriptionPlain || ''),
      skills: extractSkillsFromJD(j.descriptionPlain || j.descriptionHtml || ''),
      experience_min: inferMinExperience(j.title, j.descriptionPlain || ''),
      experience_max: inferMaxExperience(j.title, j.descriptionPlain || ''),
      employment_type: inferEmploymentType(j.title),
      posted_at: j.publishedAt || new Date().toISOString(),
    }));
  } catch (err) {
    log.warn(`Ashby fetch failed: ${orgSlug}`, { error: err.message });
    return [];
  }
}

// ── Master Ingestion ─────────────────────────────────────────────────────────

/**
 * Fetch jobs from ALL configured sources.
 * Returns a flat array of normalized JobRaw objects.
 */
export async function ingestAllJobs() {
  const startMs = performance.now();
  log.info('Starting full job ingestion cycle');

  // Run all fetches in parallel with concurrency control
  const batches = [
    ...GREENHOUSE_BOARDS.map(b => () => fetchGreenhouseBoard(b)),
    ...LEVER_ACCOUNTS.map(a => () => fetchLeverBoard(a)),
    ...ASHBY_BOARDS.map(b => () => fetchAshbyBoard(b)),
  ];

  const allJobs = [];
  const BATCH_SIZE = 5; // 5 concurrent fetches at a time

  for (let i = 0; i < batches.length; i += BATCH_SIZE) {
    const batch = batches.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(fn => fn()));

    for (const result of results) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        allJobs.push(...result.value);
      }
    }
  }

  const durationMs = Math.round(performance.now() - startMs);
  log.info('Job ingestion complete', {
    total: allJobs.length,
    sources: {
      greenhouse: GREENHOUSE_BOARDS.length,
      lever: LEVER_ACCOUNTS.length,
      ashby: ASHBY_BOARDS.length,
    },
    durationMs,
  });

  return allJobs;
}

/**
 * Fetch jobs from a single source (for targeted refresh).
 */
export async function ingestFromSource(type, identifier) {
  switch (type) {
    case 'greenhouse': return fetchGreenhouseBoard(identifier);
    case 'lever': return fetchLeverBoard(identifier);
    case 'ashby': return fetchAshbyBoard(identifier);
    default: return [];
  }
}

// ── Extraction Helpers ───────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
}

const SKILL_KEYWORDS = [
  'javascript', 'typescript', 'python', 'java', 'go', 'golang', 'rust', 'c++', 'c#',
  'ruby', 'php', 'swift', 'kotlin', 'scala', 'r',
  'react', 'vue', 'angular', 'next.js', 'nextjs', 'nuxt', 'svelte',
  'node.js', 'nodejs', 'express', 'fastify', 'django', 'flask', 'spring', 'rails',
  'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb', 'cassandra',
  'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'k8s', 'terraform', 'jenkins',
  'graphql', 'rest', 'grpc', 'kafka', 'rabbitmq',
  'machine learning', 'deep learning', 'nlp', 'computer vision', 'pytorch', 'tensorflow',
  'langchain', 'openai', 'llm', 'rag', 'vector database', 'pinecone',
  'figma', 'tailwind', 'css', 'html', 'sass',
  'git', 'ci/cd', 'linux', 'agile', 'scrum',
  'supabase', 'firebase', 'prisma', 'drizzle', 'sql',
];

function extractSkillsFromJD(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return SKILL_KEYWORDS.filter(skill => {
    // Word boundary check to avoid partial matches
    const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(lower);
  });
}

function inferMinExperience(title, description) {
  const lower = (title + ' ' + description).toLowerCase();
  if (lower.includes('intern') || lower.includes('trainee')) return 0;
  if (lower.includes('entry') || lower.includes('junior') || lower.includes('new grad') || lower.includes('graduate')) return 0;
  if (lower.includes('mid') || lower.includes('sde ii') || lower.includes('sde 2')) return 2;
  if (lower.includes('senior') || lower.includes('sde iii') || lower.includes('lead')) return 5;
  if (lower.includes('staff') || lower.includes('principal')) return 8;

  // Try to extract from description
  const yearMatch = description.match(/(\d+)\+?\s*years?\s*(of\s*)?(experience|exp)/i);
  if (yearMatch) return parseInt(yearMatch[1]);

  return 0;
}

function inferMaxExperience(title, description) {
  const min = inferMinExperience(title, description);
  const lower = (title + ' ' + description).toLowerCase();
  if (lower.includes('intern')) return 1;
  if (lower.includes('junior') || lower.includes('entry')) return 2;
  if (min === 0) return 3;
  return min + 5;
}

function inferEmploymentType(title) {
  const lower = title.toLowerCase();
  if (lower.includes('intern')) return 'internship';
  if (lower.includes('contract') || lower.includes('freelance')) return 'contract';
  if (lower.includes('part-time') || lower.includes('part time')) return 'part-time';
  return 'full-time';
}

export { GREENHOUSE_BOARDS, LEVER_ACCOUNTS, ASHBY_BOARDS };
