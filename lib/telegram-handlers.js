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
import { analyzeGithubProject } from './github-analyzer.js';
import { 
  getCandidateProfile, upsertCandidateProfile,
  getActiveJobs
} from './job-db.js';
import { rankJobs as scoreJobs, buildCandidateProfile } from './job-engine.js';
import log from './logger.js';

export const handlers = {
  handleHelp: async (chatId) => {
    return handlers.send(chatId, 
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
      `_Start by uploading your resume PDF!_`
    );
  },

  handleProject: async (chatId, description) => {
    if (!description) return handlers.send(chatId, "⚠️ Please provide a project description or GitHub URL.");
    
    // If GitHub, use specialized analyzer
    if (description.includes('github.com')) {
      await handlers.send(chatId, `🔍 Accessing GitHub API for deep analysis...`);
      try {
        const result = await analyzeGithubProject(description, (prompt) => callGemini(null, prompt));
        return handlers.send(chatId, `🚀 *Project DNA Analysis*\n\n${result.report}`);
      } catch (err) {
        log.error('GitHub Analysis Failed', { error: err.message });
      }
    }

    await handlers.send(chatId, "🚀 Analyzing your project DNA...");
    const systemPrompt = buildProjectPrompt();
    const response = await analyzeProject({ systemPrompt, description });
    return handlers.send(chatId, `🚀 *Project DNA Analysis*\n\n${response}`);
  },

  handleDeep: async (chatId, company) => {
    await handlers.send(chatId, `🕵️ Researching ${company}...`);
    const systemPrompt = buildDeepResearchPrompt();
    const response = await researchCompany({ systemPrompt, companyName: company });
    return handlers.send(chatId, `🕵️ *Deep Research: ${company}*\n\n${response}`);
  },

  handleTailor: async (chatId, userId, input) => {
    const cvText = await getCV(userId);
    if (!cvText) return handlers.send(chatId, "❌ No CV found. Please upload a PDF resume first.");

    let jdText = input;
    if (input.match(/^https?:\/\//)) {
      await handlers.send(chatId, `🔍 Scraping job description...`);
      const scraped = await fetchJobDescription(input);
      jdText = scraped.text;
    }

    await handlers.send(chatId, `🧠 Tailoring resume — this may take a moment...`);
    const systemPrompt = buildTailorPrompt({ role: 'the specified role', company: 'the specified company', jd: jdText });
    const response = await tailorResume({ systemPrompt, cvText });
    return handlers.send(chatId, `✨ *ATS-Tailored Resume*\n\n${response}`);
  },

  handleJobs: async (chatId, userId, filter) => {
    try {
      const cvText = await getCV(userId);
      let profile = getCandidateProfile(userId);

      if (!profile) {
        profile = buildCandidateProfile(cvText || '');
        upsertCandidateProfile(userId, profile);
      }

      const jobs = getActiveJobs(100);
      if (!jobs.length) return handlers.send(chatId, "📡 No jobs in database yet. Try again in a few minutes.");

      const ranked = scoreJobs(jobs, profile, 5);
      if (!ranked.length) return handlers.send(chatId, "🏹 No matches found for your profile. Upload your CV for better results!");

      const report = ranked.map((r, i) => {
        const pct = Math.round(r.score * 10);
        return `🎯 *${i + 1}. ${r.job.company} — ${r.job.title}*\n` +
               `📊 Fit: ${pct}% · 📍 ${r.job.location}\n` +
               `🔗 [Apply](${r.job.url})`;
      }).join('\n\n');

      return handlers.send(chatId, `🏹 *Top Job Matches for You*\n\n${report}`);
    } catch (err) {
      log.error('Telegram Jobs Error', { error: err.message, userId });
      return handlers.send(chatId, "❌ Job recommendation failed. Please try again.");
    }
  },

  handleTracker: async (chatId, userId) => {
    const apps = await getUserApplications(userId);
    if (!apps || apps.length === 0) return handlers.send(chatId, "📊 You haven't evaluated any jobs yet!");
    
    const summary = apps.slice(0, 10).map(a => `- *${a.company}* (${a.role}): **${a.score}/10**`).join('\n');
    return handlers.send(chatId, `📊 *Your Recent Applications*\n\n${summary}`);
  },

  handleEvaluate: async (chatId, userId, url) => {
    if (!url || !url.match(/^https?:\/\//)) return handlers.send(chatId, "🎯 Please provide a valid job URL.");
    
    await handlers.send(chatId, `🔍 Scraping job description...`);
    const scraped = await fetchJobDescription(url);
    const cvText = await getCV(userId);
    
    await handlers.send(chatId, `✅ Scraped! Now evaluating against your CV...`);
    const systemPrompt = buildEvaluationPrompt(cvText);
    const rawResponse = await evaluateJD({ systemPrompt, jdText: scraped.text });

    const { company, role, score, archetype, legitimacy, rawReport } = parseScore(rawResponse);
    const emoji = scoreEmoji(score);
    
    saveApplication({
      discordId: userId,
      company, role, score, archetype, legitimacy,
      jdSnippet: scraped.text.slice(0, 500),
      reportText: rawReport,
    });

    const reportMsg =
      `🎯 *Job Evaluation — ${company}*\n` +
      `_${role}_\n\n` +
      `📊 *Score:* ${emoji} ${score}/10.0\n` +
      `🏷️ *Archetype:* ${archetype}\n\n` +
      `${rawReport}`;

    return handlers.send(chatId, reportMsg);
  },

  handleConversational: async (chatId, userId, text) => {
    const cvText = await getCV(userId);
    const systemPrompt = buildConversationalPrompt(cvText);
    const response = await careerChat({ systemPrompt, userMessage: text });
    return handlers.send(chatId, response);
  }
};
