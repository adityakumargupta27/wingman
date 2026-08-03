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

    // 1. Fetch Repository Metadata (with robust fallback for unauthenticated rate limits / private repos)
    const repoMeta = await safeGet(`${GH_API}/repos/${owner}/${repo}`, headers) || {
      name: repo,
      full_name: `${owner}/${repo}`,
      description: `GitHub repository: ${owner}/${repo}`,
      stargazers_count: 0,
      forks_count: 0,
      default_branch: 'main'
    };

    // 2. Fetch README
    const readme = await getReadme(owner, repo, headers);

    // 3. Fetch Languages
    const languages = await safeGet(`${GH_API}/repos/${owner}/${repo}/languages`, headers);

    // 4. Fetch File Tree (to detect frameworks/tools)
    const defaultBranch = repoMeta.default_branch || 'main';
    const treeData = await safeGet(`${GH_API}/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`, headers) 
                  || await safeGet(`${GH_API}/repos/${owner}/${repo}/git/trees/main?recursive=1`, headers) 
                  || await safeGet(`${GH_API}/repos/${owner}/${repo}/git/trees/master?recursive=1`, headers);
    const tree = treeData?.tree?.map(f => f.path) || [];

    // 5. Fetch package.json if it exists (API or raw fallback)
    let packageJson = null;
    const pkgContent = await safeGet(`${GH_API}/repos/${owner}/${repo}/contents/package.json`, headers);
    if (pkgContent?.content) {
      try {
        packageJson = JSON.parse(Buffer.from(pkgContent.content, 'base64').toString('utf8'));
      } catch (e) {
        log.warn("Failed to parse package.json from API");
      }
    }
    if (!packageJson) {
      for (const path of ['package.json', 'backend/package.json', 'frontend/package.json']) {
        for (const branch of [defaultBranch, 'main', 'master']) {
          try {
            const rawPkg = await axios.get(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`, { timeout: 4000 });
            if (rawPkg.data && typeof rawPkg.data === 'object') {
              packageJson = rawPkg.data;
              break;
            } else if (typeof rawPkg.data === 'string') {
              packageJson = JSON.parse(rawPkg.data);
              break;
            }
          } catch {}
        }
        if (packageJson) break;
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
  if (!url || typeof url !== 'string') {
    throw new Error("Invalid GitHub URL. Expected: https://github.com/owner/repo");
  }
  const cleanUrl = url.trim().replace(/\/+$/, '');
  const m = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/\?#\s]+)/i);
  if (!m) throw new Error("Invalid GitHub URL. Expected: https://github.com/owner/repo");
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, '');
  return { owner, repo };
}

function buildHeaders() {
  const headers = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN;
  // Only use the token if it looks like a real GitHub PAT (not a placeholder/dummy)
  if (
    token &&
    token.length > 20 &&
    !token.includes('dummy') &&
    !token.includes('your_') &&
    !token.includes('placeholder') &&
    (token.startsWith('ghp_') || token.startsWith('github_pat_11'))
  ) {
    headers.Authorization = `Bearer ${token}`;
  }
  return { headers };
}

async function safeGet(url, config) {
  try {
    const { data } = await axios.get(url, config);
    return data;
  } catch (err) {
    // If we got a 401 (bad credentials), retry WITHOUT the auth header
    if (err.response?.status === 401 && config?.headers?.Authorization) {
      log.warn('GitHub API 401 — retrying without auth token', { url });
      try {
        const fallbackConfig = { headers: { Accept: "application/vnd.github+json" } };
        const { data } = await axios.get(url, fallbackConfig);
        return data;
      } catch (retryErr) {
        log.warn('GitHub API retry also failed', { url, error: retryErr.message });
        return null;
      }
    }
    log.warn('GitHub API request failed', { url, status: err.response?.status, error: err.message });
    return null;
  }
}

async function getReadme(owner, repo, config) {
  try {
    const { data } = await axios.get(`${GH_API}/repos/${owner}/${repo}/readme`, config);
    return Buffer.from(data.content, "base64").toString("utf8").slice(0, 3000);
  } catch {
    // Fallback to raw githubusercontent (bypasses GitHub API rate limits)
    for (const branch of ['main', 'master']) {
      try {
        const rawRes = await axios.get(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`, { timeout: 5000 });
        if (rawRes.data && typeof rawRes.data === 'string') {
          return rawRes.data.slice(0, 3000);
        }
      } catch {}
    }
    return "No README found.";
  }
}

function detectStack({ languages, packageJson, tree }) {
  const stack = [];
  const langKeys = Object.keys(languages || {});

  // Primary languages
  for (const lang of langKeys) {
    stack.push(lang);
  }

  if (packageJson) {
    const deps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };

    if (deps["react"]) stack.push("React");
    if (deps["next"]) stack.push("Next.js");
    if (deps["vue"]) stack.push("Vue");
    if (deps["svelte"]) stack.push("Svelte");
    if (deps["express"]) stack.push("Express");
    if (deps["@nestjs/core"]) stack.push("NestJS");
    if (deps["fastify"]) stack.push("Fastify");
    if (deps["discord.js"]) stack.push("Discord.js");
    if (deps["telegram"] || deps["node-telegram-bot-api"]) stack.push("Telegram Bot API");
    if (deps["tailwindcss"]) stack.push("Tailwind CSS");
    if (deps["prisma"]) stack.push("Prisma ORM");
    if (deps["drizzle-orm"]) stack.push("Drizzle ORM");
    if (deps["mongoose"]) stack.push("Mongoose/MongoDB");
    if (deps["pg"]) stack.push("PostgreSQL");
    if (deps["redis"] || deps["ioredis"]) stack.push("Redis Caching");
    if (deps["socket.io"] || deps["ws"]) stack.push("WebSockets (Real-Time)");
    if (deps["@trpc/server"]) stack.push("tRPC");
    if (deps["graphql"]) stack.push("GraphQL");
    if (deps["playwright"] || deps["puppeteer"]) stack.push("Headless Web Scraping");
    if (deps["jest"] || deps["vitest"] || deps["cypress"]) stack.push("Automated Testing Suite");
    if (deps["firebase"] || deps["firebase-admin"]) stack.push("Firebase");
    if (deps["@supabase/supabase-js"]) stack.push("Supabase");
  }

  if (tree.some((x) => x?.includes("Dockerfile") || x?.includes("docker-compose"))) stack.push("Docker");
  if (tree.some((x) => x?.includes(".github/workflows"))) stack.push("CI/CD Automation");
  if (tree.some((x) => x?.includes("vercel.json"))) stack.push("Vercel");
  if (tree.some((x) => x?.includes("railway"))) stack.push("Railway");
  if (tree.some((x) => x?.includes("k8s") || x?.includes("kubernetes"))) stack.push("Kubernetes");
  if (tree.some((x) => x?.includes("terraform"))) stack.push("Terraform (IaC)");

  return [...new Set(stack)];
}

function buildPrompt(data) {
  return `
You are a Principal Software Architect and Technical Hiring Director at FAANG.
Analyze this GitHub project with brutal technical accuracy and zero fluff.

📦 REPOSITORY METADATA
Repo: ${data.owner}/${data.repo}
Description: ${data.meta.description || "No description provided"}
Stars: ${data.meta.stargazers_count || 0}
Forks: ${data.meta.forks_count || 0}
Stack Detected: ${data.stack.join(", ") || "Unknown"}
Languages Breakbyte: ${JSON.stringify(data.languages || {})}

📄 README CONTENT EXTRACT:
${data.readme}

---

📐 RIGOROUS COMPLEXITY CALIBRATION RUBRIC (1–10 SCALE):
- 1–3 (Basic / Starter): Simple static landing page, basic single-table CRUD without auth, standard tutorial clone (todo app, weather widget).
- 4–5 (Intermediate / Full-Stack Starter): Standard full-stack CRUD with JWT/OAuth, single database integration, basic REST API, standard UI state.
- 6–7 (Advanced / Production-Grade): Multi-service or modular architecture, custom middleware, ORM migrations, Redis caching, real-time WebSockets, Docker containerization, CI/CD pipelines, comprehensive automated tests.
- 8–9 (Enterprise / System-Level): Distributed systems, custom compiler/parser/engine, high-throughput message queues (Kafka/RabbitMQ), stateful concurrency management, custom DB drivers/algorithms, Infrastructure-as-Code.
- 10 (FAANG Core / Breakthrough): Novel protocol, open-source core framework used in production by thousands, custom GPU/CUDA kernel operations.

CRITICAL INSTRUCTIONS:
1. Do NOT inflate scores for basic CRUD applications. A standard Todo app or basic Express/React CRUD is a 3-4/10.
2. Base your complexity rating on actual architectural engineering signals (concurrency, caching, state management, custom logic, data modeling), NOT star count or README length.
3. Be specific, technical, and objective.

---

🧬 REQUIRED OUTPUT FORMAT:

🧬 PROJECT SNAPSHOT
Name: ${data.owner}/${data.repo}
Stack: ${data.stack.join(", ") || "Unknown"}
Complexity: X/10 (State exact rating & 1-sentence technical justification)
Category: <Web App | CLI Tool | API | Distributed System | ML Pipeline | Library | DevOps | Other>

🔍 CAPABILITIES EXTRACTED
List 4-6 specific technical engineering skills proven by this codebase.
Format: \`Skill Name\` — specific code/architectural evidence from project.

💼 BEST-FIT ROLES
3-4 targeted job titles where this project serves as strong proof-of-work.

📝 RESUME BULLETS (STAR+R Format)
Generate 3 ATS-optimized resume bullet points.
Each bullet MUST:
- Start with a high-impact action verb
- Mention specific tools/frameworks
- Include quantified engineering impact (even estimated metrics)

📈 LEVEL-UP RECOMMENDATIONS
2-3 high-leverage architectural additions that would upgrade this project to the next tier.

🎯 INTERVIEW TALKING POINTS
2 tough technical questions an interviewer will ask about this codebase + winning answer framework.
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
