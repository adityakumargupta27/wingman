/* =========================================================
WINGMAN GITHUB ANALYZER MODULE
Drop-in production Node.js module for Wingman bot

FILES:
lib/github-analyzer.js
Usage:
const report = await analyzeGithubProject(url, callAI)

Requires:
npm i axios

ENV:
GITHUB_TOKEN=optional_but_recommended
========================================================= */

import axios from "axios";
import log from "./logger.js";

/* =========================================================
CONFIG
========================================================= */

const GH_API = "https://api.github.com";
const HEADERS = process.env.GITHUB_TOKEN
  ? {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    }
  : {
      Accept: "application/vnd.github+json",
    };

/* =========================================================
MAIN EXPORT
========================================================= */

/**
 * Deeply analyzes a GitHub repository using the GitHub API.
 * 
 * @param {string} repoUrl - The URL of the GitHub repository
 * @param {Function} aiFn - A function that takes a prompt and returns a string (the AI response)
 */
export async function analyzeGithubProject(repoUrl, aiFn) {
  const { owner, repo } = parseGithubUrl(repoUrl);

  const [
    repoMeta,
    languages,
    readme,
    commits,
    packageJson,
    tree,
  ] = await Promise.allSettled([
    getRepoMeta(owner, repo),
    getLanguages(owner, repo),
    getReadme(owner, repo),
    getCommitStats(owner, repo),
    getPackageJson(owner, repo),
    getRepoTree(owner, repo),
  ]);

  const meta = unwrap(repoMeta, {});
  const langs = unwrap(languages, {});
  const readmeText = unwrap(readme, "");
  const commitInfo = unwrap(commits, {});
  const pkg = unwrap(packageJson, null);
  const repoTree = unwrap(tree, []);

  const detected = detectStack({
    languages: langs,
    packageJson: pkg,
    tree: repoTree,
  });

  const prompt = buildProjectPrompt({
    owner,
    repo,
    meta,
    langs,
    readmeText,
    commitInfo,
    pkg,
    detected,
    repoTree,
  });

  const aiResponse = await aiFn(prompt);

  return {
    owner,
    repo,
    meta,
    languages: langs,
    detected,
    report: aiResponse,
  };
}

/* =========================================================
URL PARSER
========================================================= */

function parseGithubUrl(url) {
  const clean = url.trim().replace(/\/+$/, "");
  const match = clean.match(
    /github\.com\/([^\/]+)\/([^\/\?#]+)/i
  );

  if (!match) {
    throw new Error("Invalid GitHub repository URL.");
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

/* =========================================================
GITHUB FETCHERS
========================================================= */

async function getRepoMeta(owner, repo) {
  const { data } = await axios.get(
    `${GH_API}/repos/${owner}/${repo}`,
    { headers: HEADERS }
  );

  return {
    name: data.name,
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    watchers: data.watchers_count,
    issues: data.open_issues_count,
    defaultBranch: data.default_branch,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    visibility: data.visibility,
    homepage: data.homepage,
  };
}

async function getLanguages(owner, repo) {
  const { data } = await axios.get(
    `${GH_API}/repos/${owner}/${repo}/languages`,
    { headers: HEADERS }
  );

  return data;
}

async function getReadme(owner, repo) {
  try {
    const { data } = await axios.get(
      `${GH_API}/repos/${owner}/${repo}/readme`,
      { headers: HEADERS }
    );

    return Buffer.from(
      data.content,
      "base64"
    ).toString("utf8").slice(0, 12000);
  } catch {
    return "";
  }
}

async function getCommitStats(owner, repo) {
  try {
    const { data } = await axios.get(
      `${GH_API}/repos/${owner}/${repo}/commits?per_page=10`,
      { headers: HEADERS }
    );

    return {
      recentCommits: data.length,
      lastCommit:
        data[0]?.commit?.author?.date || null,
    };
  } catch {
    return {};
  }
}

async function getPackageJson(owner, repo) {
  try {
    const { data } = await axios.get(
      `${GH_API}/repos/${owner}/${repo}/contents/package.json`,
      { headers: HEADERS }
    );

    const raw = Buffer.from(
      data.content,
      "base64"
    ).toString("utf8");

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getRepoTree(owner, repo) {
  try {
    // Need meta to get default branch
    const { data: meta } = await axios.get(
        `${GH_API}/repos/${owner}/${repo}`,
        { headers: HEADERS }
      );
    const branch = meta.default_branch;

    const { data } = await axios.get(
      `${GH_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: HEADERS }
    );

    return data.tree
      .slice(0, 300)
      .map((f) => f.path);
  } catch {
    return [];
  }
}

/* =========================================================
STACK DETECTOR
========================================================= */

function detectStack({ languages, packageJson, tree }) {
  const stack = [];

  const langKeys = Object.keys(languages);

  if (langKeys.includes("JavaScript")) stack.push("JavaScript");
  if (langKeys.includes("TypeScript")) stack.push("TypeScript");
  if (langKeys.includes("Python")) stack.push("Python");
  if (langKeys.includes("Java")) stack.push("Java");

  if (packageJson) {
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (deps.react) stack.push("React");
    if (deps.next) stack.push("Next.js");
    if (deps.express) stack.push("Express");
    if (deps.discord.js) stack.push("Discord Bot");
    if (deps.telegram) stack.push("Telegram Bot");
    if (deps.tailwindcss) stack.push("Tailwind CSS");
    if (deps.prisma) stack.push("Prisma");
    if (deps.mongoose) stack.push("MongoDB");
  }

  if (tree.some((x) => x.includes("Dockerfile"))) {
    stack.push("Docker");
  }

  if (tree.some((x) => x.includes(".github/workflows"))) {
    stack.push("CI/CD");
  }

  if (tree.some((x) => x.includes("vercel.json"))) {
    stack.push("Vercel Deploy");
  }

  if (tree.some((x) => x.includes("railway"))) {
    stack.push("Railway Deploy");
  }

  return [...new Set(stack)];
}

/* =========================================================
PROMPT BUILDER
========================================================= */

function buildProjectPrompt(data) {
  return `
You are a senior engineering recruiter and startup CTO.

Analyze this GitHub repository deeply and return ONLY useful career signal.

════════ PROJECT DATA ════════

Repo: ${data.owner}/${data.repo}

Description:
${data.meta.description || "Unknown"}

Stars: ${data.meta.stars}
Forks: ${data.meta.forks}

Languages:
${JSON.stringify(data.langs)}

Detected Stack:
${data.detected.join(", ")}

Recent Commits:
${data.commitInfo.recentCommits || 0}

Last Commit:
${data.commitInfo.lastCommit || "Unknown"}

README:
${data.readmeText || "No README"}

Files:
${data.repoTree.slice(0, 80).join(", ")}

════════ OUTPUT FORMAT ════════

🧬 Project DNA Analysis

⭐ Complexity Rating: x/10

🔍 Hidden Skills Found
(5-8 bullet points)

💼 Best Fit Roles
(4 roles)

📈 Resume Bullets
(3 ATS bullets)

🚀 Missing Upgrades
(3 improvements)

🎤 Interview Pitch
(How candidate should explain this project)

💰 Market Value
(entry / strong student / internship-ready / hireable / standout)

Be blunt. No fluff.
`;
}

/* =========================================================
HELPER
========================================================= */

function unwrap(result, fallback) {
  return result.status === "fulfilled"
    ? result.value
    : fallback;
}
