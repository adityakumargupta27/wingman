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

    // 2. Fetch README
    const readme = await getReadme(owner, repo, headers);

    // 3. Fetch Languages
    const languages = await safeGet(`${GH_API}/repos/${owner}/${repo}/languages`, headers);

    // 4. Fetch File Tree (to detect frameworks/tools)
    const treeData = await safeGet(`${GH_API}/repos/${owner}/${repo}/git/trees/main?recursive=1`, headers) 
                  || await safeGet(`${GH_API}/repos/${owner}/${repo}/git/trees/master?recursive=1`, headers);
    const tree = treeData?.tree?.map(f => f.path) || [];

    // 5. Fetch package.json if it exists
    const pkgContent = await safeGet(`${GH_API}/repos/${owner}/${repo}/contents/package.json`, headers);
    let packageJson = null;
    if (pkgContent?.content) {
      try {
        packageJson = JSON.parse(Buffer.from(pkgContent.content, 'base64').toString('utf8'));
      } catch (e) {
        log.warn("Failed to parse package.json");
      }
    }

    // 6. Detect Stack
    const stack = detectStack({ languages, packageJson, tree });

    // 7. Build Prompt
    const prompt = buildPrompt({
      owner,
      repo,
      meta: repoMeta,
      readme,
      stack,
      languages
    });

    // 8. Execute AI or Fallback
    let report;
    if (typeof aiFn === "function") {
      try {
        log.info("Requesting AI analysis for project", { owner, repo });
        report = await aiFn(prompt);
        if (!report || typeof report !== 'string') throw new Error("AI returned invalid or empty response");
      } catch (aiErr) {
        log.error("AI PROJECT FAIL:", { 
          message: aiErr.message, 
          stack: aiErr.stack?.split('\n').slice(0, 2).join('\n'),
          repo: `${owner}/${repo}`
        });
        report = fallbackLocalReport({ owner, repo, meta: repoMeta, stack, aiError: aiErr.message });
      }
    } else {
      report = fallbackLocalReport({ owner, repo, meta: repoMeta, stack });
    }

    return {
      ok: true,
      report
    };

  } catch (err) {
    log.error("GITHUB_ANALYZER_ERROR:", { error: err.message, stack: err.stack, url: repoUrl });
    return {
      ok: false,
      error: err.message,
      stack: err.stack
    };
  }
}

/* =========================================================
HELPERS
========================================================= */

function parseRepo(url) {
  const m = url.trim().match(/github\.com\/([^\/]+)\/([^\/\?#]+)/i);
  if (!m) throw new Error("Invalid GitHub URL. Expected: https://github.com/owner/repo");
  return { owner: m[1], repo: m[2] };
}

function buildHeaders() {
  const headers = { Accept: "application/vnd.github+json" };
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
    return null;
  }
}

async function getReadme(owner, repo, config) {
  try {
    const { data } = await axios.get(`${GH_API}/repos/${owner}/${repo}/readme`, config);
    // Reduced to 3000 chars to avoid API context window / token limit issues
    return Buffer.from(data.content, "base64").toString("utf8").slice(0, 3000);
  } catch {
    return "No README found.";
  }
}

function detectStack({ languages, packageJson, tree }) {
  const stack = [];
  const langKeys = Object.keys(languages || {});

  if (langKeys.includes("JavaScript")) stack.push("JavaScript");
  if (langKeys.includes("TypeScript")) stack.push("TypeScript");
  if (langKeys.includes("Python")) stack.push("Python");
  if (langKeys.includes("Java")) stack.push("Java");

  if (packageJson) {
    const deps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };

    if (deps["react"]) stack.push("React");
    if (deps["next"]) stack.push("Next.js");
    if (deps["express"]) stack.push("Express");
    if (deps["discord.js"]) stack.push("Discord Bot");
    if (deps["telegram"]) stack.push("Telegram Bot");
    if (deps["tailwindcss"]) stack.push("Tailwind CSS");
    if (deps["prisma"]) stack.push("Prisma");
    if (deps["mongoose"]) stack.push("MongoDB");
    if (deps["firebase"]) stack.push("Firebase");
  }

  if (tree.some((x) => x?.includes("Dockerfile"))) stack.push("Docker");
  if (tree.some((x) => x?.includes(".github/workflows"))) stack.push("CI/CD");
  if (tree.some((x) => x?.includes("vercel.json"))) stack.push("Vercel");
  if (tree.some((x) => x?.includes("railway"))) stack.push("Railway");

  return [...new Set(stack)];
}

function buildPrompt(data) {
  return `
Analyze this GitHub project deeply.

Repo: ${data.owner}/${data.repo}
Description: ${data.meta.description || "None"}
Stars: ${data.meta.stargazers_count || 0}
Forks: ${data.meta.forks_count || 0}
Stack Detected: ${data.stack.join(", ") || "Unknown"}
Languages: ${JSON.stringify(data.languages || {})}

README Extract:
${data.readme}

🧬 Output Format:
1. Complexity /10
2. Skills Shown
3. Resume Bullets (3)
4. Interview Pitch
`;
}

function fallbackLocalReport(data) {
  return `
🧬 *Project DNA Analysis (Local Mode)*

Repo: ${data.owner}/${data.repo}
⭐ Stars: ${data.meta.stargazers_count || 0}
💻 Stack: ${data.stack.join(", ") || "Unknown"}

⚠️ *AI analysis was skipped or failed.*
${data.aiError ? `📌 *Reason:* ${data.aiError}` : ''}
`;
}
