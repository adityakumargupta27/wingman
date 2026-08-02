import 'dotenv/config';
import axios from 'axios';

const GH_API = 'https://api.github.com';

// Replicate the exact safeGet + buildHeaders from github-analyzer.js
function buildHeaders() {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.length > 5) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return { headers };
}

async function safeGet(url, config) {
  try {
    const { data } = await axios.get(url, config);
    return data;
  } catch (err) {
    console.log('safeGet FAILED:', url, err.message, err.response?.status, err.response?.data?.message);
    return null;
  }
}

const headers = buildHeaders();
console.log('Headers config:', JSON.stringify(headers));

const owner = 'vercel';
const repo = 'next.js';

console.log('\n--- Testing repo metadata ---');
const repoMeta = await safeGet(`${GH_API}/repos/${owner}/${repo}`, headers);
console.log('repoMeta:', repoMeta ? `${repoMeta.full_name} (${repoMeta.stargazers_count} stars)` : 'NULL');

console.log('\n--- Testing languages ---');
const languages = await safeGet(`${GH_API}/repos/${owner}/${repo}/languages`, headers);
console.log('languages:', languages ? Object.keys(languages) : 'NULL');

console.log('\n--- Testing rate limit ---');
const rateLimit = await safeGet(`${GH_API}/rate_limit`, headers);
console.log('Rate limit:', rateLimit?.resources?.core);
