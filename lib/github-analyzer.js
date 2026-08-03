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

    // 4. Fetch File Tree (API first, HTML scrape fallback if API is rate-limited)
    const defaultBranch = repoMeta.default_branch || 'main';
    const treeData = await safeGet(`${GH_API}/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`, headers) 
                  || await safeGet(`${GH_API}/repos/${owner}/${repo}/git/trees/main?recursive=1`, headers) 
                  || await safeGet(`${GH_API}/repos/${owner}/${repo}/git/trees/master?recursive=1`, headers);
    let tree = treeData?.tree?.map(f => f.path) || [];

    if (!tree || tree.length === 0) {
      tree = await scrapeTreeFromHTML(owner, repo);
    }

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

async function scrapeTreeFromHTML(owner, repo) {
  try {
    const url = `https://github.com/${owner}/${repo}`;
    const res = await axios.get(url, {
      timeout: 6000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const html = res.data;
    const regex = new RegExp(`\\/${owner}\\/${repo}\\/(blob|tree)\\/[^\\/]+\\/([^\\s"\'?#]+)`, 'g');
    const matches = [...html.matchAll(regex)];
    const paths = [...new Set(matches.map(m => decodeURIComponent(m[2])))];
    return paths;
  } catch (err) {
    log.warn('HTML tree scrape fallback failed', { owner, repo, error: err.message });
    return [];
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

async function fetchCodeSamples(owner, repo, defaultBranch, tree) {
  if (!Array.isArray(tree) || tree.length === 0) return [];

  const CODE_EXTENSIONS = ['.cpp', '.hpp', '.c', '.h', '.java', '.py', '.rs', '.go', '.cs', '.ts', '.js', '.v', '.sv', '.vhdl', '.asm', '.kt', '.swift', '.rb'];
  
  // Exclude third-party or build dirs
  const candidateFiles = tree.filter(f => {
    if (!f || typeof f !== 'string') return false;
    const lower = f.toLowerCase();
    if (lower.includes('node_modules/') || lower.includes('vendor/') || lower.includes('dist/') || lower.includes('build/') || lower.includes('.min.')) return false;
    return CODE_EXTENSIONS.some(ext => lower.endsWith(ext));
  }).sort((a, b) => {
    const priorityKeywords = ['algo', 'core', 'engine', 'src', 'math', 'solver', 'model', 'processor', 'sim', 'graphics', 'struct', 'tree', 'graph', 'dp'];
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    const aScore = priorityKeywords.reduce((acc, kw) => acc + (aLower.includes(kw) ? 2 : 0), 0);
    const bScore = priorityKeywords.reduce((acc, kw) => acc + (bLower.includes(kw) ? 2 : 0), 0);
    return bScore - aScore;
  });

  const samples = [];
  let totalChars = 0;
  const MAX_SAMPLES = 4;
  const MAX_TOTAL_CHARS = 4500;

  for (const filePath of candidateFiles.slice(0, 12)) {
    if (samples.length >= MAX_SAMPLES || totalChars >= MAX_TOTAL_CHARS) break;
    for (const branch of [defaultBranch, 'main', 'master']) {
      try {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
        const res = await axios.get(url, { timeout: 4000, responseType: 'text' });
        if (res.data && typeof res.data === 'string' && res.data.trim().length > 40) {
          const snippet = res.data.slice(0, 1200);
          samples.push({ path: filePath, snippet });
          totalChars += snippet.length;
          break;
        }
      } catch {}
    }
  }

  return samples;
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
  const codeSection = data.codeSamples && data.codeSamples.length > 0
    ? data.codeSamples.map(s => `--- FILE: ${s.path} ---\n${s.snippet}`).join('\n\n')
    : "No direct source code snippets extracted.";

  const treeSection = (data.tree || []).slice(0, 45).join('\n') || "No file tree available.";

  return `
You are a Principal Software Architect, Systems Engineer, and Technical Hiring Director at FAANG.
Analyze this GitHub project with brutal technical accuracy, algorithm-first evaluation, and zero fluff.

📦 REPOSITORY METADATA
Repo: ${data.owner}/${data.repo}
Description: ${data.meta.description || "No description provided"}
Stars: ${data.meta.stargazers_count || 0} | Forks: ${data.meta.forks_count || 0}
Stack Detected: ${data.stack.join(", ") || "Unknown"}
Languages Breakdown: ${JSON.stringify(data.languages || {})}

📂 FILE TREE PATHS (First 45 files):
${treeSection}

💻 ACTUAL CODE SNIPPETS / CORE LOGIC:
${codeSection}

📄 README CONTENT EXTRACT:
${data.readme}

---

📐 RIGOROUS ALGORITHMIC & SYSTEMS COMPLEXITY RUBRIC (1–10 SCALE):

Evaluate complexity PRIMARILY by ALGORITHMIC DEPTH, COMPUTATIONAL LOGIC, AND SYSTEM ARCHITECTURE:

1. Algorithmic & Data Structure Complexity (WEIGHT: 40%)
   - Does this project implement custom data structures (Tries, Graphs, Heaps, Segment Trees, Disjoint Set Union), complex algorithmic paradigms (Dynamic Programming, Graph Traversals, BFS/DFS, A* Search, Backtracking, Divide & Conquer, Network Flow, Computational Geometry), custom math/physics/matrix solvers, or custom AI/ML logic from scratch?
2. Systems & Low-Level Engineering (WEIGHT: 35%)
   - Does this project implement low-level logic (Hardware/Processor simulation like 32-bit RISC/ARM/CPU models, Verilog/HDL, Bitwise manipulation, Pointers/Memory Management, Custom Compiler/Lexer/Parser, Stateful WebSockets, Concurrency, Caching)?
3. System Architecture & Full-Stack Integration (WEIGHT: 25%)
   - ORM schemas, microservices, state machines, API contracts, automated testing, containerization.

CALIBRATED SCORE BANDS:
- 1–3 (Basic / Starter): Simple static landing page, basic single-table CRUD without custom algorithms, standard tutorial clone (todo app, weather widget).
- 4–5 (Intermediate / Standard App): Full-stack CRUD with standard libraries, basic algorithmic logic (standard array filter/map), standard DB integrations.
- 6–7 (Advanced / High Algorithmic or System Depth): Custom algorithms (Graph algorithms, Dynamic Programming, A* search, custom state machines, custom parsers, mathematical simulations), custom data structures, ORMs + caching, multi-threading/concurrency, memory management.
- 8–9 (Enterprise / Deep Algorithmic Systems): Complex distributed algorithms, custom compiler/lexer, hardware/CPU core simulators (e.g. 32-bit RISC/ARM processor models, computational geometry, custom graphics engines, physics solvers), high-throughput message queues, custom DB engine/storage driver.
- 10 (FAANG Core / World-Class Math & Systems): Industry-standard core framework, novel AI/ML kernel (CUDA/Triton), novel cryptographic or distributed consensus protocol.

CRITICAL ALGORITHMIC INSTRUCTIONS:
1. If a project implements custom algorithms, data structures, or hardware/CPU models (e.g. 32-bit RISC processor, Graph Simulators, Matrix Solvers, Neural Networks from scratch, Physics Engines, Raytracers, Vector Editors), DO NOT PENALIZE IT FOR LACKING A WEB FRONTEND OR DOCKER FILE. It MUST be scored high (7–9/10) based on algorithmic and computational complexity alone!
2. Do NOT inflate scores for basic CRUD applications. A standard Todo app or basic Express/React CRUD is a 3-4/10.
3. Base your rating on the actual CODE SNIPPETS, FILE TREE, and ALGORITHMS provided above.

---

🧬 REQUIRED OUTPUT FORMAT:

🧬 PROJECT SNAPSHOT
Name: ${data.owner}/${data.repo}
Stack: ${data.stack.join(", ") || "Unknown"}
Complexity: X/10 (State exact rating & 1-sentence algorithmic/technical justification)
Category: <Web App | CLI Tool | API | Distributed System | Hardware/CPU Simulator | Algorithmic Engine | ML Pipeline | Library | DevOps | Other>

🔍 CAPABILITIES & ALGORITHMS EXTRACTED
List 4-6 specific technical skills and algorithmic/system capabilities proven by this codebase.
Format: \`Skill/Algorithm Name\` — specific code/architectural evidence from project.

💼 BEST-FIT ROLES
3-4 targeted job titles where this project serves as strong proof-of-work (e.g. Systems Engineer, Algorithmic Engineer, Embedded/Hardware Engineer, Full Stack Engineer).

📝 RESUME BULLETS (STAR+R Format)
Generate 3 ATS-optimized resume bullet points.
Each bullet MUST:
- Start with a high-impact action verb
- Highlight algorithmic complexity, custom data structures, or performance optimizations
- Include quantified engineering impact (even estimated metrics)

📈 LEVEL-UP RECOMMENDATIONS
2-3 high-leverage algorithmic or architectural additions that would upgrade this project to the next tier.

🎯 INTERVIEW TALKING POINTS
2 tough technical questions an interviewer will ask about this algorithm/codebase + winning answer framework.
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
