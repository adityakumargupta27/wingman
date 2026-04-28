/**
 * lib/telegram.js — Telegram Bot Platform for Wingman
 *
 * Production-grade Telegram integration with:
 *   - Deterministic command routing (no cross-contamination)
 *   - Per-user rate limiting
 *   - Clean error boundaries per command
 *   - Reconnect with exponential backoff
 *   - Every handler uses isolated AI context
 */

import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { fetchJobDescription, ScraperError } from './scraper.js';
import {
  callGemini, evaluateJD, researchCompany,
  analyzeProject, tailorResume, careerChat,
} from './gemini.js';
import {
  buildEvaluationPrompt, buildProjectPrompt,
  buildDeepResearchPrompt, buildTailorPrompt,
  buildJobHunterPrompt, buildConversationalPrompt,
} from './prompt-engine.js';
import { parseScore, scoreEmoji } from './score-parser.js';
import { getCV, setCV, upsertUser, getUserApplications, saveApplication } from './db.js';
import log from './logger.js';

let bot = null;
let reconnectTimer = null;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 10;
const BASE_RECONNECT_DELAY = 5_000;
const MAX_RECONNECT_DELAY  = 300_000;

// ── Per-user rate limiting ────────────────────────────────────────────────────
const userCooldowns = new Map();
const COOLDOWN_MS = 5_000; // 5 seconds between commands

function isRateLimited(userId) {
  const last = userCooldowns.get(userId);
  if (last && Date.now() - last < COOLDOWN_MS) return true;
  userCooldowns.set(userId, Date.now());
  return false;
}

// Clean up old entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - COOLDOWN_MS * 2;
  for (const [uid, ts] of userCooldowns) {
    if (ts < cutoff) userCooldowns.delete(uid);
  }
}, 300_000);

// ── Boot ──────────────────────────────────────────────────────────────────────

export function startTelegramBot() {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token || token.includes('your_')) {
    log.warn('Telegram token not provided. Telegram bot will not start.');
    return;
  }
  launchBot(token);
}

function launchBot(token) {
  if (bot) {
    try { bot.stopPolling(); } catch {}
    bot = null;
  }

  try {
    bot = new TelegramBot(token, {
      polling: {
        autoStart: true,
        params: { timeout: 30 },
      },
    });
    log.info('Telegram bot started in polling mode');
    consecutiveErrors = 0;
  } catch (err) {
    log.error('Failed to create Telegram bot instance', { error: err.message });
    scheduleReconnect(token);
    return;
  }

  // Register command menu
  bot.setMyCommands([
    { command: 'start',   description: 'Welcome message and help' },
    { command: 'help',    description: 'Show all available features' },
    { command: 'project', description: 'Analyze project DNA (e.g. /project GitHub link)' },
    { command: 'deep',    description: 'Deep research a company (e.g. /deep Stripe)' },
    { command: 'tailor',  description: 'Tailor resume to a job (e.g. /tailor URL)' },
    { command: 'tracker', description: 'View your job application tracker' },
    { command: 'jobs',    description: 'Smart job recommendations based on your CV' },
  ]).catch(err => log.error('Failed to set Telegram commands', { error: err.message }));

  // ── Error Handling ─────────────────────────────────────────────────────────
  bot.on('polling_error', (err) => {
    consecutiveErrors++;
    if (consecutiveErrors === 1 || consecutiveErrors % 20 === 0) {
      log.error('Telegram polling error', {
        error: (err.message || String(err)).slice(0, 200),
        consecutiveErrors,
      });
    }
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      log.warn('Too many Telegram polling errors — reconnecting', { consecutiveErrors });
      try { bot.stopPolling(); } catch {}
      scheduleReconnect(token);
    }
  });

  // ── Message Router ─────────────────────────────────────────────────────────
  // DETERMINISTIC ROUTING: Each command goes to its own isolated handler.
  // No shared handler. No cross-contamination.

  bot.on('message', async (msg) => {
    consecutiveErrors = 0; // Connection healthy

    const chatId   = msg.chat.id;
    const userId   = msg.from.id.toString();
    const username = msg.from.username || msg.from.first_name || 'User';

    // Register user
    upsertUser(userId, username);

    // Rate limit check
    if (isRateLimited(userId)) {
      return; // Silently ignore spam
    }

    // ── PDF Upload Handler ─────────────────────────────────────────────────
    if (msg.document) {
      if (msg.document.mime_type === 'application/pdf') {
        return safeHandle(chatId, () => handlePdfUpload(chatId, userId, msg.document.file_id));
      }
      return bot.sendMessage(chatId, "⚠️ Please upload a **PDF** file for your resume.", { parse_mode: 'Markdown' });
    }

    const text = msg.text || '';
    if (!text) return;

    // ── COMMAND ROUTER ─────────────────────────────────────────────────────
    // Deterministic switch routing. No ambiguity.

    if (text === '/start' || text === '/help') {
      return handleHelp(chatId);
    }

    if (text.startsWith('/project')) {
      const desc = text.replace('/project', '').trim();
      if (!desc) return bot.sendMessage(chatId, "⚠️ Usage: `/project Built a React dashboard with Supabase`", { parse_mode: 'Markdown' });
      return safeHandle(chatId, () => handleProject(chatId, desc));
    }

    if (text.startsWith('/deep')) {
      const company = text.replace('/deep', '').trim();
      if (!company) return bot.sendMessage(chatId, "⚠️ Usage: `/deep Stripe`", { parse_mode: 'Markdown' });
      return safeHandle(chatId, () => handleDeep(chatId, company));
    }

    if (text.startsWith('/tailor')) {
      const input = text.replace('/tailor', '').trim();
      if (!input) return bot.sendMessage(chatId, "⚠️ Usage: `/tailor https://job-url-here`", { parse_mode: 'Markdown' });
      return safeHandle(chatId, () => handleTailor(chatId, userId, input));
    }

    if (text === '/tracker') {
      return safeHandle(chatId, () => handleTracker(chatId, userId));
    }

    if (text.startsWith('/jobs')) {
      const filter = text.replace('/jobs', '').trim() || null;
      return safeHandle(chatId, () => handleJobs(chatId, userId, filter));
    }

    // ── URL Detection (auto-evaluate) ────────────────────────────────────
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      return safeHandle(chatId, () => handleEvaluate(chatId, userId, urlMatch[0]));
    }

    // ── Unknown Commands ─────────────────────────────────────────────────
    if (text.startsWith('/')) {
      return bot.sendMessage(chatId, "⚠️ Unknown command. Use /help to see available features.");
    }

    // ── Conversational AI ────────────────────────────────────────────────
    return safeHandle(chatId, () => handleConversational(chatId, userId, text));
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ISOLATED COMMAND HANDLERS
// Each handler has its own try/catch. One failure never affects another.
// Each handler creates FRESH AI context. No shared state.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Wraps any handler in a crash-proof boundary.
 * If the handler throws, the user gets a clean error message.
 * The bot process never dies.
 */
async function safeHandle(chatId, handler) {
  try {
    await handler();
  } catch (err) {
    log.error('Telegram handler crashed', { error: err.message, chatId });
    try {
      await bot.sendMessage(chatId, `❌ Something went wrong: ${err.message?.slice(0, 200) || 'Unknown error'}`);
    } catch {}
  }
}

function handleHelp(chatId) {
  return bot.sendMessage(
    chatId,
    `🤖 *Wingman AI — Career Intelligence Bot*\n\n` +
    `*Available Commands:*\n` +
    `📄 *Upload PDF* — Send me your resume PDF to store it\n` +
    `🔗 *Paste URL* — Send any job link to evaluate it against your CV\n` +
    `🚀 */project [desc]* — Analyze your project DNA\n` +
    `🕵️ */deep [company]* — Deep company research\n` +
    `✂️ */tailor [url]* — Tailor your CV to a specific job\n` +
    `📊 */tracker* — View your job application history\n` +
    `🏹 */jobs* — Smart job recommendations\n` +
    `💬 *Chat* — Just talk to me for career advice!\n\n` +
    `_Start by uploading your resume PDF!_`,
    { parse_mode: 'Markdown' }
  );
}

async function handlePdfUpload(chatId, userId, fileId) {
  const statusMsg = await bot.sendMessage(chatId, "📄 Downloading and parsing your resume...");
  try {
    const fileLink = await bot.getFileLink(fileId);
    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const data = await pdf(response.data);

    if (!data.text || !data.text.trim()) {
      throw new Error('Could not extract text from this PDF. It may be scanned/image-based.');
    }

    setCV(userId, data.text);
    await bot.editMessageText(
      `✅ *Resume saved!*\nExtracted ${data.text.length.toLocaleString()} characters.\nNow send me a job link to evaluate it!`,
      { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
    );
  } catch (err) {
    log.error('Telegram PDF Parse Error', { error: err.message, userId });
    await bot.editMessageText(`❌ Failed to parse PDF: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
  }
}

async function handleProject(chatId, description) {
  const statusMsg = await bot.sendMessage(chatId, "🚀 Analyzing your project DNA...");
  try {
    // ISOLATED: buildProjectPrompt() returns ONLY the system persona
    // description goes as USER content via analyzeProject()
    const systemPrompt = buildProjectPrompt();
    const response = await analyzeProject({ systemPrompt, description });

    await bot.editMessageText(`🚀 *Project DNA Analysis*\n\n${response.slice(0, 4000)}`, {
      chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown'
    });
  } catch (err) {
    await bot.editMessageText(`❌ Analysis failed: ${err.message?.slice(0, 200)}`, {
      chat_id: chatId, message_id: statusMsg.message_id
    });
  }
}

async function handleDeep(chatId, company) {
  const statusMsg = await bot.sendMessage(chatId, `🕵️ Researching ${company}...`);
  try {
    // ISOLATED: Company name goes as USER content
    const systemPrompt = buildDeepResearchPrompt();
    const response = await researchCompany({ systemPrompt, companyName: company });

    await bot.editMessageText(`🕵️ *Deep Research: ${company}*\n\n${response.slice(0, 4000)}`, {
      chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown'
    });
  } catch (err) {
    await bot.editMessageText(`❌ Research failed: ${err.message?.slice(0, 200)}`, {
      chat_id: chatId, message_id: statusMsg.message_id
    });
  }
}

async function handleEvaluate(chatId, userId, url) {
  const statusMsg = await bot.sendMessage(chatId, `🔍 Scraping job description...\nURL: ${url}`);
  try {
    // Step 1: Scrape — errors are clean ScraperErrors, never raw Playwright
    const scraped = await fetchJobDescription(url);

    await bot.editMessageText(`✅ Scraped! Now evaluating against your CV...`, {
      chat_id: chatId, message_id: statusMsg.message_id
    });

    // Step 2: Evaluate with FRESH context
    const cvText = await getCV(userId);
    const systemPrompt = buildEvaluationPrompt(cvText);
    const rawResponse = await evaluateJD({ systemPrompt, jdText: scraped.text });

    // Step 3: Parse structured score
    const { company, role, score, archetype, legitimacy, rawReport } = parseScore(rawResponse);
    const emoji = scoreEmoji(score);
    const scoreDisplay = score !== null ? `${score.toFixed(1)} / 10.0` : '? / 10.0';

    // Step 4: Save to tracker
    saveApplication({
      discordId: userId,
      company, role, score, archetype, legitimacy,
      jdSnippet: scraped.text.slice(0, 500),
      reportText: rawReport,
      storiesJson: null,
    });

    // Step 5: Premium formatted response
    const reportMsg =
      `🎯 *Job Evaluation — ${company}*\n` +
      `_${role}_\n\n` +
      `📊 *Score:* ${emoji} ${scoreDisplay}\n` +
      `🏷️ *Archetype:* ${archetype}\n` +
      `🔍 *Legitimacy:* ${legitimacy}\n\n` +
      `${rawReport.slice(0, 3000)}`;

    await bot.editMessageText(reportMsg, {
      chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown'
    });

  } catch (err) {
    log.error('Telegram Evaluation Error', { error: err.message, userId });
    const userMsg = err instanceof ScraperError
      ? err.message  // Already user-facing
      : `❌ Evaluation failed: ${err.message?.slice(0, 200) || 'Unknown error'}`;
    await bot.editMessageText(userMsg, { chat_id: chatId, message_id: statusMsg.message_id });
  }
}

async function handleTailor(chatId, userId, input) {
  const statusMsg = await bot.sendMessage(chatId, `✂️ Preparing to tailor your resume...`);
  try {
    const cvText = await getCV(userId);
    if (!cvText) {
      throw new Error("No CV found. Please upload a PDF resume first.");
    }

    let jdText = input;
    // If input is a URL, scrape it
    if (input.match(/^https?:\/\//)) {
      await bot.editMessageText(`🔍 Scraping job description...`, { chat_id: chatId, message_id: statusMsg.message_id });
      const scraped = await fetchJobDescription(input);
      jdText = scraped.text;
    }

    await bot.editMessageText(`🧠 Tailoring resume — this may take a moment...`, { chat_id: chatId, message_id: statusMsg.message_id });

    // ISOLATED: JD goes in system prompt context, CV goes as user content
    const systemPrompt = buildTailorPrompt({ role: 'the specified role', company: 'the specified company', jd: jdText });
    const response = await tailorResume({ systemPrompt, cvText });

    await bot.editMessageText(`✨ *ATS-Tailored Resume*\n\n${response.slice(0, 4000)}`, {
      chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown'
    });
  } catch (err) {
    const userMsg = err instanceof ScraperError
      ? err.message
      : `❌ Tailoring failed: ${err.message?.slice(0, 200)}`;
    await bot.editMessageText(userMsg, { chat_id: chatId, message_id: statusMsg.message_id });
  }
}

async function handleTracker(chatId, userId) {
  const applications = getUserApplications(userId, 5);
  if (!applications || applications.length === 0) {
    return bot.sendMessage(chatId, "📊 *Job Tracker*\n\nNo applications yet. Send me a job URL to get started!", { parse_mode: 'Markdown' });
  }

  let msg = "📊 *Job Tracker (Last 5)*\n\n";
  applications.forEach((app, idx) => {
    const score = app.score !== null ? app.score.toFixed(1) : '?';
    msg += `${idx + 1}. *${app.company}* — ${app.role}\n`;
    msg += `   Score: \`${score}/10\` | Status: ${app.status}\n\n`;
  });

  await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

async function handleJobs(chatId, userId, filterKeyword) {
  bot.sendChatAction(chatId, 'typing');
  try {
    // Dynamic imports to avoid circular dependency
    const { getCandidateProfile, upsertCandidateProfile, getActiveJobs, saveRecommendations, getJobCount } = await import('./job-db.js');
    const { buildCandidateProfile, rankJobs, filterJobs, filterRemoteOnly } = await import('./job-engine.js');
    const { runIngestionCycle } = await import('./job-scheduler.js');

    const cvText = await getCV(userId);
    let profile = getCandidateProfile(userId);

    // Auto-build profile from CV
    if (!profile && cvText) {
      profile = buildCandidateProfile(cvText);
      upsertCandidateProfile(userId, profile);
    } else if (!profile) {
      profile = buildCandidateProfile('');
    }

    // Get jobs from DB
    let jobs = getActiveJobs(2000);

    // If empty, trigger first ingestion
    if (jobs.length === 0) {
      await bot.sendMessage(chatId, '📡 First-time setup — fetching jobs from 40+ companies. This takes ~30 seconds...');
      await runIngestionCycle();
      jobs = getActiveJobs(2000);
    }

    if (jobs.length === 0) {
      return bot.sendMessage(chatId, '❌ No jobs available right now. Sources may be temporarily down. Try again later.');
    }

    // Apply filter
    if (filterKeyword) {
      const lower = filterKeyword.toLowerCase();
      if (lower === 'remote') {
        jobs = filterRemoteOnly(jobs);
      } else {
        jobs = filterJobs(jobs, filterKeyword);
      }
      if (jobs.length === 0) {
        return bot.sendMessage(chatId, `❌ No jobs matching "${filterKeyword}". Try: remote, frontend, backend, intern, python, react`);
      }
    }

    // Score and rank
    const ranked = rankJobs(jobs, profile, 7);
    saveRecommendations(userId, ranked.filter(r => r.job.id));

    // Format for Telegram
    const totalJobs = getJobCount();
    let msg = `🏹 *Job Matches${filterKeyword ? ` — "${filterKeyword}"` : ''}*\n`;
    msg += `_Scored ${totalJobs} jobs against your profile_\n\n`;

    ranked.forEach((r, i) => {
      const pct = Math.round(r.score * 10);
      const emoji = pct >= 70 ? '🟢' : pct >= 50 ? '🟡' : '🟠';
      const type = r.job.employment_type === 'internship' ? ' · 🎓 Intern' : '';

      msg += `${emoji} *${i + 1}. ${r.job.company} — ${r.job.title}*\n`;
      msg += `📊 ${pct}% Fit · 📍 ${r.job.location}${type}\n`;

      if (r.reasons.length > 0) msg += `✅ ${r.reasons[0]}\n`;
      if (r.gaps.length > 0) msg += `⚠️ ${r.gaps[0]}\n`;

      if (r.job.url) msg += `🔗 [Apply](${r.job.url})\n`;
      msg += '\n';
    });

    msg += `_Level: ${profile.level} · Skills: ${profile.skills.slice(0, 4).join(', ')}_`;

    // Inline keyboard
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🌍 Remote Only', callback_data: 'jobs_remote' },
            { text: '🎓 Internships', callback_data: 'jobs_intern' },
          ],
          [
            { text: '📡 Refresh', callback_data: 'jobs_refresh' },
            { text: '🔄 More', callback_data: 'jobs_more' },
          ],
        ],
      },
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    };

    await bot.sendMessage(chatId, msg.slice(0, 4000), keyboard);

  } catch (err) {
    log.error('Telegram Jobs Error', { error: err.message, userId });
    await bot.sendMessage(chatId, `❌ Job search failed: ${err.message?.slice(0, 200)}`);
  }
}

async function handleConversational(chatId, userId, userText) {
  bot.sendChatAction(chatId, 'typing');
  try {
    const cvText = await getCV(userId);
    // ISOLATED: Fresh conversational context per message
    const systemPrompt = buildConversationalPrompt(cvText);
    const response = await careerChat({ systemPrompt, userMessage: userText });

    await bot.sendMessage(chatId, response.slice(0, 4000), { parse_mode: 'Markdown' });
  } catch (err) {
    log.error('Telegram Chat Error', { error: err.message });
    await bot.sendMessage(chatId, "❌ I'm having trouble right now. Please try again.");
  }
}

// ── Reconnect with Exponential Backoff ────────────────────────────────────────

function scheduleReconnect(token) {
  if (reconnectTimer) return;

  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, Math.floor(consecutiveErrors / MAX_CONSECUTIVE_ERRORS)),
    MAX_RECONNECT_DELAY
  );

  log.info(`Scheduling Telegram reconnect in ${Math.round(delay / 1000)}s`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    consecutiveErrors = 0;
    log.info('Attempting Telegram reconnect...');
    launchBot(token);
  }, delay);
}
