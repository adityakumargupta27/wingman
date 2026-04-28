/**
 * lib/github-analyzer.js — Defensive GitHub Repository Intelligence
 * 
 * ESM Version (Project uses "type": "module")
 */

import axios from "axios";
import log from "./logger.js";

const GH_API = "https://api.github.com";

/**
 * Deeply analyzes a GitHub repository.
 * Defensive implementation with fallback reporting.
 * 
 * @param {string} repoUrl - The URL of the GitHub repository
 * @param {Function} aiFn - Optional AI callback (prompt => response)
 */
export async function analyzeGithubProject(repoUrl, aiFn) {
  try {
    const { owner, repo } = parseRepo(repoUrl);
    const headers = buildHeaders();

    // 1. Fetch Repository Metadata
    const repoMeta = await safeGet(`${GH_API}/repos/${owner}/${repo}`, headers);
    if (!repoMeta) {
      throw new Error("Repository not found or GitHub API rate limited.");
    }

    // 2. Fetch README (essential for context)
    const readme = await getReadme(owner, repo, headers);

    // 3. Fetch Languages
    const langs = await safeGet(`${GH_API}/repos/${owner}/${repo}/languages`, headers);

    // 4. Build Prompt
    const prompt = buildPrompt({
      owner,
      repo,
      meta: repoMeta,
      readme,
      langs
    });

    // 5. Execute AI or Fallback
    let report;
    if (typeof aiFn === "function") {
      try {
        report = await aiFn(prompt);
      } catch (aiErr) {
        log.error("AI Project Analysis failed, using local fallback", { error: aiErr.message });
        report = fallbackLocalReport({ owner, repo, meta: repoMeta, langs });
      }
    } else {
      report = fallbackLocalReport({ owner, repo, meta: repoMeta, langs });
    }

    return {
      ok: true,
      report
    };

  } catch (err) {
    log.error("GITHUB_ANALYZER_ERROR:", { error: err.message, url: repoUrl });
    return {
      ok: false,
      error: err.message
    };
  }
}

/* =========================================================
HELPERS
========================================================= */

function parseRepo(url) {
  const m = url.trim().match(/github\.com\/([^\/]+)\/([^\/\?#]+)/i);
  if (!m) throw new Error("Invalid GitHub URL. Expected: https://github.com/owner/repo");

  return {
    owner: m[1],
    repo: m[2]
  };
}

function buildHeaders() {
  const headers = {
    Accept: "application/vnd.github+json"
  };

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
    log.warn(`GitHub API call failed: ${url}`, { status: err.response?.status });
    return null;
  }
}

async function getReadme(owner, repo, config) {
  try {
    const { data } = await axios.get(`${GH_API}/repos/${owner}/${repo}/readme`, config);
    return Buffer.from(data.content, "base64").toString("utf8").slice(0, 8000);
  } catch {
    return "No README found for this repository.";
  }
}

function buildPrompt(data) {
  return `
Analyze this GitHub project deeply and return career signal.

Repo: ${data.owner}/${data.repo}
Description: ${data.meta.description || "None provided"}
Stars: ${data.meta.stargazers_count || 0}
Forks: ${data.meta.forks_count || 0}
Main Language: ${data.meta.language || "Unknown"}

Languages Distribution:
${JSON.stringify(data.langs || {})}

README Extract:
${data.readme}

════════ OUTPUT FORMAT ════════

🧬 Project DNA Analysis

1. Complexity Score: x/10
2. Real Skills Demonstrated: (list 5)
3. Resume Bullets: (3 STAR+R bullets)
4. Best Fit Roles: (list 3)
5. Missing Upgrades: (2 improvements)
6. Interview Pitch: (30-second summary)

Be blunt. No fluff.
`;
}

function fallbackLocalReport(data) {
  return `
🧬 *Project DNA Analysis (Local Mode)*

Repo: ${data.owner}/${data.repo}
⭐ Stars: ${data.meta.stargazers_count || 0}
🍴 Forks: ${data.meta.forks_count || 0}
💻 Main Language: ${data.meta.language || "Unknown"}

*Likely Skills Demonstrated:*
• Version Control (Git/GitHub)
• ${data.meta.language || 'Software Engineering'}
• Project Documentation

⚠️ _AI analysis was temporarily unavailable. This is a basic metadata report._
`;
}
