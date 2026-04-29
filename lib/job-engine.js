/**
 * lib/job-engine.js — Fit Scoring + Ranking + Explainability Engine
 *
 * The core moat. Takes a candidate profile and a pool of jobs,
 * scores each job on 7 weighted dimensions, ranks them with
 * diversity constraints, and generates human-readable explanations.
 *
 * Formula:
 *   Score = 0.30×SkillMatch + 0.20×ExpMatch + 0.15×RolePref
 *         + 0.10×LocationFit + 0.10×CompanyQuality + 0.10×GrowthUpside
 *         + 0.05×Freshness
 */

import log from './logger.js';

// ── Weights ──────────────────────────────────────────────────────────────────

const WEIGHTS = {
  skill:     0.30,
  experience: 0.20,
  rolePref:  0.15,
  location:  0.10,
  company:   0.10,
  growth:    0.10,
  freshness: 0.05,
};

// ── Title Normalization ──────────────────────────────────────────────────────

const TITLE_ALIASES = {
  'ui engineer': 'frontend engineer',
  'ui developer': 'frontend engineer',
  'front-end': 'frontend',
  'front end': 'frontend',
  'product engineer': 'fullstack engineer',
  'software development engineer': 'software engineer',
  'sde': 'software engineer',
  'sde i': 'software engineer entry',
  'sde ii': 'software engineer mid',
  'sde iii': 'senior software engineer',
  'swe': 'software engineer',
  'devops engineer': 'platform engineer',
  'site reliability': 'sre',
  'ml engineer': 'machine learning engineer',
  'data analyst': 'data analyst',
  'bi analyst': 'data analyst',
};

function normalizeTitle(title) {
  let lower = title.toLowerCase().trim();
  for (const [alias, canonical] of Object.entries(TITLE_ALIASES)) {
    if (lower.includes(alias)) {
      lower = lower.replace(alias, canonical);
    }
  }
  return lower;
}

// ── Role Category Mapping ────────────────────────────────────────────────────

const ROLE_CATEGORIES = {
  frontend:  ['frontend', 'react', 'vue', 'angular', 'ui', 'web developer', 'design engineer'],
  backend:   ['backend', 'api', 'server', 'platform', 'infrastructure', 'systems'],
  fullstack: ['fullstack', 'full-stack', 'full stack', 'product engineer'],
  data:      ['data', 'analytics', 'bi ', 'business intelligence', 'etl'],
  ml:        ['machine learning', 'ml ', 'ai ', 'deep learning', 'nlp', 'computer vision', 'llm'],
  devops:    ['devops', 'sre', 'platform', 'cloud', 'infrastructure', 'reliability'],
  mobile:    ['mobile', 'ios', 'android', 'react native', 'flutter'],
  security:  ['security', 'infosec', 'cybersecurity', 'appsec'],
};

function categorizeRole(title) {
  const lower = normalizeTitle(title);
  for (const [category, keywords] of Object.entries(ROLE_CATEGORIES)) {
    if (keywords.some(kw => lower.includes(kw))) return category;
  }
  return 'general';
}

// ── Candidate Profile Builder ────────────────────────────────────────────────

/**
 * Build a candidate profile from CV text and preferences.
 * This is the "Candidate Intelligence Engine" from the spec.
 */
export function buildCandidateProfile(cvText, preferences = {}) {
  const lower = (cvText || '').toLowerCase();

  // Expanded tech skill dictionary
  const TECH_SKILLS = [
    'javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c++', 'c#',
    'ruby', 'php', 'swift', 'kotlin', 'scala', 'dart', 'solidity',
    'react', 'vue', 'angular', 'next.js', 'svelte', 'node.js', 'express',
    'django', 'flask', 'spring', 'rails', 'fastapi', 'nest.js', 'laravel',
    'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb', 'sqlite',
    'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'jenkins', 'ansible',
    'graphql', 'rest', 'kafka', 'rabbitmq', 'grpc',
    'pytorch', 'tensorflow', 'langchain', 'openai', 'anthropic', 'machine learning', 'nlp', 'llm',
    'figma', 'tailwind', 'css', 'html', 'git', 'linux', 'sql', 'nosql',
    'supabase', 'firebase', 'prisma', 'drizzle', 'selenium', 'playwright',
    'frontend', 'backend', 'fullstack', 'devops', 'sre', 'cloud', 'mobile', 'security'
  ];

  const skills = TECH_SKILLS.filter(s => lower.includes(s));

  // Infer experience level
  let experienceYears = 0;
  const yearMatches = lower.match(/(\d{4})\s*[-–]\s*(present|\d{4})/gi) || [];
  const currentYear = new Date().getFullYear();
  for (const match of yearMatches) {
    const years = match.match(/(\d{4})/g);
    if (years) {
      const start = parseInt(years[0]);
      const end = years[1] && years[1] !== 'present' ? parseInt(years[1]) : currentYear;
      experienceYears = Math.max(experienceYears, end - start);
    }
  }

  // Determine level
  let level = 'student';
  if (lower.includes('intern') || lower.includes('student')) level = 'student';
  else if (experienceYears <= 2) level = 'junior';
  else if (experienceYears <= 5) level = 'mid';
  else if (experienceYears <= 10) level = 'senior';
  else level = 'staff';

  // Infer strength scores by category
  const strengthScore = {};
  for (const [category, keywords] of Object.entries(ROLE_CATEGORIES)) {
    const matchCount = keywords.filter(kw => lower.includes(kw)).length;
    const skillMatch = skills.filter(s => {
      if (category === 'frontend') return ['react', 'vue', 'angular', 'css', 'html', 'tailwind', 'figma', 'next.js', 'svelte'].includes(s);
      if (category === 'backend') return ['node.js', 'express', 'django', 'flask', 'spring', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'kafka'].includes(s);
      if (category === 'ml') return ['pytorch', 'tensorflow', 'langchain', 'openai', 'machine learning'].includes(s);
      if (category === 'devops') return ['docker', 'kubernetes', 'terraform', 'aws', 'gcp', 'azure', 'linux'].includes(s);
      return false;
    }).length;
    strengthScore[category] = Math.min(10, (matchCount + skillMatch) * 2);
  }

  // Infer preferred roles from skills
  const preferredRoles = preferences.preferred_roles || [];
  if (preferredRoles.length === 0) {
    // Auto-detect from strength scores
    const sorted = Object.entries(strengthScore).sort((a, b) => b[1] - a[1]);
    for (const [cat, score] of sorted) {
      if (score > 2) preferredRoles.push(cat);
      if (preferredRoles.length >= 3) break;
    }
  }

  return {
    level,
    experience_years: experienceYears,
    skills,
    preferred_roles: preferredRoles,
    locations: preferences.locations || ['Remote'],
    avoid_roles: preferences.avoid_roles || [],
    strength_score: strengthScore,
    salary_band: level === 'student' ? 'intern/fresher' : level,
  };
}

// ── Fit Scoring Engine ───────────────────────────────────────────────────────

/**
 * Score a single job against a candidate profile.
 * Returns a score 0-100 with component breakdown and explanation.
 */
export function scoreJob(job, profile) {
  const components = {};

  // 1. Skill Match (0-10) with Fuzzy Matching
  const jobSkills = (job.skills || []).map(s => s.toLowerCase());
  const userSkills = (profile.skills || []).map(s => s.toLowerCase());
  
  if (jobSkills.length === 0) {
    components.skill = 6; // Assume partial match if job doesn't list explicit skills
  } else {
    // Fuzzy match logic: check aliases and substring overlaps
    let matches = 0;
    for (const jSkill of jobSkills) {
      if (userSkills.some(uSkill => isFuzzyMatch(uSkill, jSkill))) {
        matches++;
      }
    }
    components.skill = Math.min(10, Math.round((matches / jobSkills.length) * 12)); // Slight multiplier for high matches
  }

  // 2. Experience Match (0-10)
  const userExp = profile.experience_years;
  const jobMin = job.experience_min ?? 0;
  const jobMax = job.experience_max ?? 99;

  if (userExp >= jobMin && userExp <= jobMax) {
    components.experience = 10;
  } else if (userExp < jobMin) {
    const gap = jobMin - userExp;
    components.experience = Math.max(0, 10 - gap * 3);
  } else {
    // Overqualified penalty
    const excess = userExp - jobMax;
    components.experience = Math.max(2, 10 - excess * 2);
  }

  // Student mode boost: intern/entry roles get extra points
  if (profile.level === 'student' && job.employment_type === 'internship') {
    components.experience = Math.min(10, components.experience + 3);
  }

  // 3. Role Preference Match (0-10)
  const jobCategory = categorizeRole(job.title);
  if (profile.avoid_roles.includes(jobCategory)) {
    components.rolePref = 0;
  } else if (profile.preferred_roles.includes(jobCategory)) {
    components.rolePref = 10;
  } else {
    components.rolePref = 4; // Neutral
  }

  // 4. Location Fit (0-10)
  const jobLocation = (job.location || '').toLowerCase();
  const userLocations = (profile.locations || []).map(l => l.toLowerCase());

  if (jobLocation.includes('remote') || userLocations.some(l => jobLocation.includes(l))) {
    components.location = 10;
  } else if (userLocations.includes('remote') && !jobLocation.includes('on-site')) {
    components.location = 6;
  } else {
    components.location = 3;
  }

  // 5. Company Quality (0-10) — based on source + known companies
  const KNOWN_PREMIUM = [
    'stripe', 'cloudflare', 'figma', 'notion', 'datadog', 'vercel', 'supabase',
    'netflix', 'spotify', 'canva', 'coinbase', 'databricks', 'gitlab',
    'razorpay', 'cred', 'zerodha', 'groww',
  ];
  const companyLower = (job.company || '').toLowerCase();
  if (KNOWN_PREMIUM.includes(companyLower)) {
    components.company = 9;
  } else if (job.source === 'greenhouse' || job.source === 'lever') {
    components.company = 7; // Companies using proper ATS are generally legit
  } else {
    components.company = 5;
  }

  // 6. Growth Upside (0-10)
  const strengthInCategory = profile.strength_score[jobCategory] || 5;
  if (strengthInCategory < 5) {
    components.growth = 8; // Learning opportunity
  } else if (strengthInCategory > 7) {
    components.growth = 5; // Comfort zone, less growth
  } else {
    components.growth = 7; // Sweet spot
  }

  // 7. Freshness (0-10)
  if (job.posted_at) {
    const ageHours = (Date.now() - new Date(job.posted_at).getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) components.freshness = 10;
    else if (ageHours < 72) components.freshness = 8;
    else if (ageHours < 168) components.freshness = 6;
    else if (ageHours < 720) components.freshness = 4;
    else components.freshness = 2;
  } else {
    components.freshness = 5;
  }

  // ── Weighted Score ─────────────────────────────────────────────────────────

  const finalScore = Math.round(
    (components.skill * WEIGHTS.skill +
     components.experience * WEIGHTS.experience +
     components.rolePref * WEIGHTS.rolePref +
     components.location * WEIGHTS.location +
     components.company * WEIGHTS.company +
     components.growth * WEIGHTS.growth +
     components.freshness * WEIGHTS.freshness) * 10
  ) / 10;

  // ── Explanation ────────────────────────────────────────────────────────────

  const reasons = [];
  const gaps = [];

  if (components.skill >= 7) {
    const overlap = (job.skills || []).filter(s => (profile.skills || []).includes(s));
    reasons.push(`Strong skill match: ${overlap.slice(0, 3).join(', ')}`);
  } else if (components.skill < 5) {
    const missing = (job.skills || []).filter(s => !(profile.skills || []).includes(s));
    gaps.push(`Missing skills: ${missing.slice(0, 3).join(', ')}`);
  }

  if (components.experience >= 8) reasons.push(`Experience level fits well`);
  else if (components.experience < 5) gaps.push(`Experience gap: needs ${job.experience_min}+ years`);

  if (components.rolePref >= 8) reasons.push(`Matches your ${jobCategory} preference`);
  if (components.location >= 8) reasons.push(`Location match: ${job.location}`);
  if (components.company >= 8) reasons.push(`Strong company brand signal`);
  if (components.freshness >= 8) reasons.push(`Recently posted`);

  if (profile.level === 'student' && job.employment_type === 'internship') {
    reasons.push(`Internship — matches your current level`);
  }

  return {
    job,
    score: finalScore,
    components,
    reasons: reasons.slice(0, 3),
    gaps: gaps.slice(0, 2),
    category: jobCategory,
  };
}

// ── Ranking Engine ───────────────────────────────────────────────────────────

/**
 * Score all jobs, rank them, and apply diversity constraints.
 *
 * Returns top N jobs with mix:
 *   - ~25% dream (score 8+)
 *   - ~50% realistic (score 6-8)
 *   - ~25% stretch/backup (score 4-6)
 *
 * Deduplicates by company+title.
 * Limits to max 3 per company to avoid flooding.
 */
export function rankJobs(jobs, profile, limit = 20) {
  // Score all jobs
  let scored = jobs.map(job => scoreJob(job, profile));

  // Remove avoided roles
  scored = scored.filter(s => !profile.avoid_roles.includes(s.category));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Dedup: same company + same normalized title
  const seen = new Set();
  scored = scored.filter(s => {
    const key = `${s.job.company.toLowerCase()}::${normalizeTitle(s.job.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Limit per company (max 3)
  const companyCount = {};
  scored = scored.filter(s => {
    const company = s.job.company.toLowerCase();
    companyCount[company] = (companyCount[company] || 0) + 1;
    return companyCount[company] <= 3;
  });

  // Diversity: ensure category variety
  const result = [];
  const categoryUsed = {};

  for (const s of scored) {
    const catCount = categoryUsed[s.category] || 0;
    // Allow max 5 from same category in top results
    if (catCount < 5 || result.length < limit / 2) {
      result.push(s);
      categoryUsed[s.category] = catCount + 1;
    }
    if (result.length >= limit) break;
  }

  // If we don't have enough, fill from remaining
  if (result.length < limit) {
    for (const s of scored) {
      if (!result.includes(s)) {
        result.push(s);
        if (result.length >= limit) break;
      }
    }
  }

  return result;
}

// ── Filter Helpers ───────────────────────────────────────────────────────────

/**
 * Filter jobs by keyword/category before scoring.
 */
export function filterJobs(jobs, keyword) {
  if (!keyword) return jobs;
  const lower = keyword.toLowerCase().trim();

  // Expand keyword to category
  const expandedTerms = [lower];
  for (const [category, keywords] of Object.entries(ROLE_CATEGORIES)) {
    if (category === lower || keywords.some(kw => kw.includes(lower))) {
      expandedTerms.push(...keywords);
    }
  }

  return jobs.filter(job => {
    const jobText = `${job.title} ${job.description || ''} ${(job.skills || []).join(' ')}`.toLowerCase();
    return expandedTerms.some(term => jobText.includes(term));
  });
}

/**
 * Filter for remote-only jobs.
 */
export function filterRemoteOnly(jobs) {
  return jobs.filter(job => {
    const loc = (job.location || '').toLowerCase();
    return loc.includes('remote') || loc.includes('anywhere') || loc.includes('distributed');
  });
}

/**
 * Filter for student/intern-level jobs.
 */
export function filterInternLevel(jobs) {
  return jobs.filter(job =>
    job.employment_type === 'internship' ||
    job.experience_min === 0 ||
    (job.experience_max !== undefined && job.experience_max <= 2)
  );
}
/**
 * Determines if two tech terms are fuzzy matches (e.g., nodejs vs node.js)
 */
function isFuzzyMatch(s1, s2) {
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n1 = normalize(s1);
  const n2 = normalize(s2);
  
  if (n1 === n2) return true;
  
  // Specific alias map
  const aliases = {
    'js': ['javascript'],
    'ts': ['typescript'],
    'react': ['reactjs', 'react.js'],
    'node': ['nodejs', 'node.js'],
    'mongo': ['mongodb'],
    'postgres': ['postgresql'],
    'ml': ['machinelearning', 'ai'],
    'aws': ['amazonwebservices'],
    'next': ['nextjs', 'next.js'],
    'tailwind': ['tailwindcss']
  };

  for (const [key, list] of Object.entries(aliases)) {
    if ((n1 === key && list.includes(n2)) || (n2 === key && list.includes(n1))) return true;
  }

  return false;
}
