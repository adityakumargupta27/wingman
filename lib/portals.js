/**
 * lib/portals.js — ATS-specific API scraping logic
 * 
 * Instead of scraping HTML, we hit direct JSON APIs for Greenhouse, Lever, and Ashby.
 * This is faster, more reliable, and avoids Cloudflare issues.
 */

import log from './logger.js';

const ATS_CONFIGS = {
  greenhouse: {
    apiUrl: (board) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
    parse: (data) => data.jobs.map(j => ({
      id: j.id,
      title: j.title,
      url: j.absolute_url,
      location: j.location?.name || 'Remote',
      updated_at: j.updated_at
    }))
  },
  lever: {
    apiUrl: (account) => `https://api.lever.co/v0/postings/${account}?mode=json`,
    parse: (data) => data.map(j => ({
      id: j.id,
      title: j.text,
      url: j.hostedUrl,
      location: j.categories?.location || 'Remote',
      updated_at: new Date(j.createdAt).toISOString()
    }))
  }
};

/**
 * Fetch jobs from a specific ATS board.
 */
export async function fetchAtsJobs(type, identifier) {
  const config = ATS_CONFIGS[type];
  if (!config) throw new Error(`Unsupported ATS type: ${type}`);

  const url = config.apiUrl(identifier);
  log.info('Fetching ATS jobs', { type, identifier, url });

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return config.parse(data);
  } catch (err) {
    log.error('ATS fetch failed', { type, identifier, error: err.message });
    return [];
  }
}
