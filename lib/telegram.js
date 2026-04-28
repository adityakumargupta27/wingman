import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { fetchJobDescription } from './scraper.js';
import { callGemini, evaluateJD } from './gemini.js';
import { buildEvaluationPrompt, buildProjectPrompt, buildDeepResearchPrompt, buildTailorPrompt } from './prompt-engine.js';
import { parseScore, scoreEmoji } from './score-parser.js';
import { getCV, setCV, upsertUser, getUserApplications } from './db.js';
import log from './logger.js';

let bot = null;
let reconnectTimer = null;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 10;
const BASE_RECONNECT_DELAY = 5_000;   // 5 seconds
const MAX_RECONNECT_DELAY  = 300_000; // 5 minutes

export function startTelegramBot() {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token || token.includes('your_')) {
    log.warn('Telegram token not provided or invalid. Telegram bot will not start.');
    return;
  }

  launchBot(token);
}

function launchBot(token) {
  // Destroy old bot instance if any
  if (bot) {
    try { bot.stopPolling(); } catch {}
    bot = null;
  }

  try {
    bot = new TelegramBot(token, {
      polling: {
        autoStart: true,
        params: { timeout: 30 },  // Long-poll timeout (seconds)
      },
    });
    log.info('Telegram bot started in polling mode');
    consecutiveErrors = 0;
  } catch (err) {
    log.error('Failed to create Telegram bot instance', { error: err.message });
    scheduleReconnect(token);
    return;
  }

  // Register the commands menu in Telegram
  bot.setMyCommands([
    { command: '/start', description: 'Show welcome message and help' },
    { command: '/help', description: 'Show all available features' },
    { command: '/project', description: 'Analyze your project capability (e.g. /project Github link)' },
    { command: '/tailor', description: 'ATS Tailor your resume to a job (e.g. /tailor URL)' },
    { command: '/tracker', description: 'View your recent job applications and scores' },
    { command: '/jobs', description: 'Auto Internship Hunter based on your CV' },
    { command: '/deep', description: 'Deep research a company (e.g. /deep Stripe)' }
  ]).catch(err => log.error('Failed to set Telegram commands', { error: err.message }));

  // ── Resilient Error Handling ─────────────────────────────────────────────
  // Prevent the infinite error storm that was flooding the logs.
  bot.on('polling_error', (err) => {
    consecutiveErrors++;
    const errMsg = err.message || String(err);

    // Only log every Nth error or when it first starts
    if (consecutiveErrors === 1 || consecutiveErrors % 20 === 0) {
      log.error('Telegram polling error', {
        error: errMsg.slice(0, 200),
        consecutiveErrors,
      });
    }

    // If too many consecutive errors, stop polling and reconnect with backoff
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      log.warn('Too many Telegram polling errors — stopping and scheduling reconnect', {
        consecutiveErrors,
      });
      try { bot.stopPolling(); } catch {}
      scheduleReconnect(token);
    }
  });

  // Reset error counter on successful message receipt
  bot.on('message', async (msg) => {
    consecutiveErrors = 0; // Connection is healthy

    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || msg.from.first_name || 'User';

    // Register user in our DB
    upsertUser(userId, username);

    // 1. Handle PDF Upload (CV Parsing)
    if (msg.document) {
      if (msg.document.mime_type === 'application/pdf') {
        return handlePdfUpload(chatId, userId, msg.document.file_id);
      } else {
        return bot.sendMessage(chatId, "⚠️ Please upload a PDF file for your resume.");
      }
    }

    const text = msg.text || '';
    if (!text) return;

    // 2. Handle /start and /help
    if (text === '/start' || text === '/help') {
      return bot.sendMessage(
        chatId,
        `🤖 **Welcome to Wingman AI!** Your personalized career co-pilot.\n\n` +
        `**Features available:**\n` +
        `📄 **Upload Resume**: Send me a PDF of your resume to store it in your profile.\n` +
        `🔗 **Evaluate Job**: Send me any job posting URL to match it against your resume.\n` +
        `🚀 **/project [desc]**: Analyze your project and extract hidden skills (Project DNA).\n` +
        `🕵️ **/deep [company]**: Perform deep research on a company.\n` +
        `💬 **Chat**: Just talk to me normally for career advice, interview prep, etc!`,
        { parse_mode: 'Markdown' }
      );
    }

    // 3. Handle /project command
    if (text.startsWith('/project')) {
      const desc = text.replace('/project', '').trim();
      if (!desc) return bot.sendMessage(chatId, "⚠️ Please provide a project description. Example: `/project Built a React dashboard with Supabase`", { parse_mode: 'Markdown' });
      return handleProject(chatId, desc);
    }

    // 4. Handle /deep command
    if (text.startsWith('/deep')) {
      const company = text.replace('/deep', '').trim();
      if (!company) return bot.sendMessage(chatId, "⚠️ Please provide a company name. Example: `/deep Stripe`", { parse_mode: 'Markdown' });
      return handleDeep(chatId, company);
    }

    // 5. Handle /tailor command (ATS Resume Tailor)
    if (text.startsWith('/tailor')) {
      const url = text.replace('/tailor', '').trim();
      if (!url) return bot.sendMessage(chatId, "⚠️ Please provide a job URL. Example: `/tailor https://...`", { parse_mode: 'Markdown' });
      return handleTailor(chatId, userId, url);
    }

    // 6. Handle /tracker command (Job Tracker & Progress Monitor)
    if (text === '/tracker') {
      return handleTracker(chatId, userId);
    }

    // 7. Handle /jobs command (Auto Internship Hunter)
    if (text === '/jobs') {
      return handleJobs(chatId, userId);
    }

    // 8. Check if message is a Job URL
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      return handleEvaluate(chatId, userId, urlMatch[0]);
    }

    // 9. Conversational AI fallback (ignore unknown slash commands)
    if (text.startsWith('/')) {
      return bot.sendMessage(chatId, "⚠️ Unknown command. Use /help to see available features.");
    }

    return handleConversational(chatId, userId, text);
  });
}

/**
 * Reconnect with exponential backoff.
 * Delay doubles each time: 5s → 10s → 20s → 40s → … → 5m max
 */
function scheduleReconnect(token) {
  if (reconnectTimer) return; // Already scheduled

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

async function handlePdfUpload(chatId, userId, fileId) {
  let statusMsg;
  try {
    statusMsg = await bot.sendMessage(chatId, "📄 Downloading and parsing your resume...");
    const fileLink = await bot.getFileLink(fileId);
    
    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const data = await pdf(response.data);
    
    setCV(userId, data.text);
    
    await bot.editMessageText(`✅ **Resume saved successfully!**\nExtracted ${data.text.length} characters of text. You can now send me job links to evaluate.`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    log.error('Telegram PDF Parse Error', { error: err.message, userId });
    if (statusMsg) {
      await bot.editMessageText(`❌ Failed to parse PDF: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
    }
  }
}

async function handleProject(chatId, description) {
  let statusMsg = await bot.sendMessage(chatId, "🚀 Analyzing your project DNA...");
  try {
    const systemPrompt = buildProjectPrompt(description);
    const response = await callGemini(systemPrompt, 'Evaluating project');
    await bot.editMessageText(`**🚀 Project DNA Analysis**\n\n${response.slice(0, 4000)}`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    await bot.editMessageText(`❌ Analysis failed: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
  }
}

async function handleDeep(chatId, company) {
  let statusMsg = await bot.sendMessage(chatId, `🕵️ Researching ${company}...`);
  try {
    const systemPrompt = buildDeepResearchPrompt();
    const response = await callGemini(systemPrompt, `COMPANY TO RESEARCH: ${company}`);
    await bot.editMessageText(`**🕵️ Deep Research: ${company}**\n\n${response.slice(0, 4000)}`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    await bot.editMessageText(`❌ Research failed: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
  }
}

async function handleEvaluate(chatId, userId, url) {
  let statusMsg;
  try {
    statusMsg = await bot.sendMessage(chatId, `🔍 Scraping job description...\nURL: ${url}`);

    const scraped = await fetchJobDescription(url);
    if (!scraped || !scraped.text) throw new Error("Failed to extract text from that URL.");

    await bot.editMessageText(`✅ Job description scraped! Now evaluating...`, { chat_id: chatId, message_id: statusMsg.message_id });

    const cvText = await getCV(userId);
    const systemPrompt = buildEvaluationPrompt(cvText);
    const rawResponse = await evaluateJD({ systemPrompt, jdText: scraped.text });
    
    const { company, role, score, archetype, legitimacy, rawReport } = parseScore(rawResponse);
    const emoji = scoreEmoji(score);
    const scoreDisplay = score !== null ? `${score.toFixed(1)} / 5.0` : '? / 5.0';

    const reportMsg = `🎯 **Job Evaluation — ${company}**\n*${role}*\n\n📊 **Score:** ${emoji} ${scoreDisplay}\n🏷️ **Archetype:** ${archetype}\n🔍 **Legitimacy:** ${legitimacy}\n\n*Detailed Report:*\n${rawReport.slice(0, 3000)}`;

    await bot.editMessageText(reportMsg, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' });
  } catch (err) {
    log.error('Telegram Evaluation Error', { error: err.message, userId });
    const errMsg = `❌ Evaluation failed:\n\n${err.message || 'Unknown error'}`;
    if (statusMsg) await bot.editMessageText(errMsg, { chat_id: chatId, message_id: statusMsg.message_id });
    else await bot.sendMessage(chatId, errMsg);
  }
}

async function handleConversational(chatId, userId, userText) {
  bot.sendChatAction(chatId, 'typing');
  try {
    const cvText = await getCV(userId);
    const systemPrompt = `You are Wingman AI, a brilliant career co-pilot and AI agent on Telegram.
You assist the user with their career, resume tailoring, interview prep, and strategy.
Be concise, helpful, and use markdown formatting.
If the user has a CV on file, use it to personalize your advice.

CANDIDATE CV CONTEXT:
${cvText ? cvText.slice(0, 5000) : '[No CV on file. Ask them to upload a PDF if relevant.]'}`;

    const response = await callGemini(systemPrompt, userText);
    await bot.sendMessage(chatId, response.slice(0, 4000), { parse_mode: 'Markdown' });
  } catch (err) {
    log.error('Telegram Chat Error', { error: err.message });
    await bot.sendMessage(chatId, "❌ I'm having trouble thinking right now. Please try again later.");
  }
}

async function handleTailor(chatId, userId, url) {
  let statusMsg = await bot.sendMessage(chatId, `✂️ Scraping job description to tailor your resume...\nURL: ${url}`);
  try {
    const scraped = await fetchJobDescription(url);
    if (!scraped || !scraped.text) throw new Error("Failed to extract text from that URL.");

    const cvText = await getCV(userId);
    if (!cvText) throw new Error("No CV found. Please upload a PDF resume first.");

    await bot.editMessageText(`✅ Job description scraped! Tailoring resume now...`, { chat_id: chatId, message_id: statusMsg.message_id });

    // Approximate company/role extraction using conversational prompt since we don't have parseScore here.
    const systemPrompt = buildTailorPrompt({ cvText, role: 'the specified role', company: 'the specified company', jd: scraped.text });
    const response = await callGemini(systemPrompt, 'Generate a tailored resume based on the JD.');

    await bot.editMessageText(`**✨ ATS-Tailored Resume Generated**\n\n${response.slice(0, 4000)}`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    await bot.editMessageText(`❌ Tailoring failed: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
  }
}

async function handleTracker(chatId, userId) {
  try {
    const applications = getUserApplications(userId, 5);
    if (!applications || applications.length === 0) {
      return bot.sendMessage(chatId, "📊 **Job Tracker**\n\nYou haven't evaluated or applied to any jobs yet. Send me a job URL to get started!");
    }

    let msg = "📊 **Job Tracker (Last 5)**\n\n";
    applications.forEach((app, idx) => {
      msg += `${idx + 1}. **${app.company}** - ${app.role}\n`;
      msg += `   Status: \`${app.status}\` | Score: ${app.score}/5\n\n`;
    });

    await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Failed to fetch tracker: ${err.message}`);
  }
}

async function handleJobs(chatId, userId) {
  bot.sendChatAction(chatId, 'typing');
  try {
    const cvText = await getCV(userId);
    const systemPrompt = `You are Wingman AI, an automated internship hunter.
The user wants you to recommend 3-4 specific, high-quality, currently available internship or job roles they should look for, based on their CV.
List real companies that hire for these roles.

CANDIDATE CV CONTEXT:
${cvText ? cvText.slice(0, 5000) : '[No CV on file. Suggest general top-tier internships.]'}`;

    const response = await callGemini(systemPrompt, "Find me the best internships/jobs right now based on my profile.");
    await bot.sendMessage(chatId, `**🏹 Auto Internship Hunter Matches**\n\n${response.slice(0, 4000)}`, { parse_mode: 'Markdown' });
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Failed to hunt jobs: ${err.message}`);
  }
}
