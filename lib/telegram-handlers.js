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
  handleHelp: async (chatId, h) => {
    return h.send(chatId, 
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

  handleProject: async (chatId, description, h) => {
    if (!description) return h.send(chatId, "⚠️ Please provide a project description or GitHub URL.");
    
    try {
      // 1. If GitHub, use specialized analyzer
      if (description.includes('github.com')) {
        await h.send(chatId, `🔍 Accessing GitHub API for deep analysis...`);
        
        const aiHandler = async (prompt) => {
          const systemPrompt = "You are a Senior CTO and Technical Recruiter. Analyze the provided GitHub repository metadata and README to extract deep engineering signals. Focus on complexity, architecture, and job-market value.";
          return await callGemini(systemPrompt, prompt);
        };

        const result = await analyzeGithubProject(description, aiHandler);
        
        if (result.ok) {
          return h.send(chatId, result.report);
        } else {
          return h.send(chatId, `❌ Project analysis failed: ${result.error}`);
        }
      }

      await h.send(chatId, "🚀 Analyzing your project DNA...");
      const systemPrompt = buildProjectPrompt();
      const response = await analyzeProject({ systemPrompt, description });
      return h.send(chatId, `🚀 *Project DNA Analysis*\n\n${response}`);
    } catch (err) {
      log.error('========== PROJECT ERROR ==========', { error: err.message, stack: err.stack, input: description });
      
      const debugMsg = `❌ *Project Analysis Failed*\n\n` +
                       `📌 *Error:* ${err.message}\n\n` +
                       `📍 *Stack:* \`${err.stack?.split("\n").slice(0, 3).join("\n")}\``;

      return h.send(chatId, debugMsg, { parse_mode: 'Markdown' });
    }
  },

  handleDeep: async (chatId, company, h) => {
    try {
      await h.send(chatId, `🕵️ Researching ${company}...`);
      const systemPrompt = buildDeepResearchPrompt();
      const response = await researchCompany({ systemPrompt, companyName: company });
      return h.send(chatId, `🕵️ *Deep Research: ${company}*\n\n${response}`);
    } catch (err) {
      log.error('RESEARCH ERROR:', { error: err.message });
      return h.send(chatId, `❌ Research failed: ${err.message}`);
    }
  },

  handleTailor: async (chatId, userId, input, h) => {
    try {
      const cvText = await getCV(userId);
      if (!cvText) return h.send(chatId, "❌ No CV found. Please upload a PDF resume first.");

      let jdText = input;
      if (input.match(/^https?:\/\//)) {
        await h.send(chatId, `🔍 Scraping job description...`);
        const scraped = await fetchJobDescription(input);
        jdText = scraped.text;
      }

      await h.send(chatId, `🧠 Tailoring resume — this may take a moment...`);
      const systemPrompt = buildTailorPrompt({ role: 'the specified role', company: 'the specified company', jd: jdText });
      const response = await tailorResume({ systemPrompt, cvText });
      return h.send(chatId, `✨ *ATS-Tailored Resume*\n\n${response}`);
    } catch (err) {
      log.error('TAILOR ERROR:', { error: err.message });
      return h.send(chatId, `❌ Tailoring failed: ${err.message}`);
    }
  },

  handleJobs: async (chatId, userId, filter, h) => {
    try {
      const cvText = await getCV(userId);
      let profile = getCandidateProfile(userId);

      if (!profile) {
        profile = buildCandidateProfile(cvText || '');
        upsertCandidateProfile(userId, profile);
      }

      const jobs = getActiveJobs(100);
      if (!jobs.length) return h.send(chatId, "📡 No jobs in database yet. Try again in a few minutes.");

      const ranked = scoreJobs(jobs, profile, 5);
      if (!ranked.length) return h.send(chatId, "🏹 No matches found for your profile. Upload your CV for better results!");

      const report = ranked.map((r, i) => {
        const pct = Math.round(r.score * 10);
        return `🎯 *${i + 1}. ${r.job.company} — ${r.job.title}*\n` +
               `📊 Fit: ${pct}% · 📍 ${r.job.location}\n` +
               `🔗 [Apply](${r.job.url})`;
      }).join('\n\n');

      return h.send(chatId, `🏹 *Top Job Matches for You*\n\n${report}`);
    } catch (err) {
      log.error('JOBS ERROR:', { error: err.message, userId });
      return h.send(chatId, "❌ Job recommendation failed. Please try again.");
    }
  },

  handleTracker: async (chatId, userId, h) => {
    try {
      const apps = await getUserApplications(userId);
      if (!apps || apps.length === 0) return h.send(chatId, "📊 You haven't evaluated any jobs yet!");
      
      const summary = apps.slice(0, 10).map(a => `- *${a.company}* (${a.role}): **${a.score}/10**`).join('\n');
      return h.send(chatId, `📊 *Your Recent Applications*\n\n${summary}`);
    } catch (err) {
      return h.send(chatId, "❌ Failed to fetch application tracker.");
    }
  },

  handleEvaluate: async (chatId, userId, url, h) => {
    if (!url || !url.match(/^https?:\/\//)) return h.send(chatId, "🎯 Please provide a valid job URL.");
    
    try {
      await h.send(chatId, `🔍 Scraping job description...`);
      const scraped = await fetchJobDescription(url);
      const cvText = await getCV(userId);
      
      await h.send(chatId, `✅ Scraped! Now evaluating against your CV...`);
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

      return h.send(chatId, reportMsg);
    } catch (err) {
      log.error('EVALUATE ERROR:', { error: err.message });
      return h.send(chatId, `❌ Evaluation failed: ${err.message}`);
    }
  },

  handleConversational: async (chatId, userId, text, h) => {
    try {
      const cvText = await getCV(userId);
      const systemPrompt = buildConversationalPrompt(cvText);
      const response = await careerChat({ systemPrompt, userMessage: text });
      return h.send(chatId, response);
    } catch (err) {
      log.error('CHAT ERROR:', { error: err.message });
      return h.send(chatId, "❌ Career chat is temporarily unavailable.");
    }
  },

  handleDocument: async (chatId, userId, document, h) => {
    try {
      const { file_id, file_name, mime_type } = document;

      if (mime_type !== 'application/pdf') {
        return h.send(chatId, "⚠️ Please upload your resume in **PDF format**.");
      }

      await h.send(chatId, `📥 Downloading your resume: *${file_name}*...`);

      // 1. Get file link from Telegram
      const fileLink = await h.bot.getFileLink(file_id);

      // 2. Download file
      const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);

      // 3. Parse PDF
      await h.send(chatId, "🔍 Parsing resume content...");
      const data = await pdf(buffer);
      const text = data.text.trim();

      if (text.length < 100) {
        return h.send(chatId, "⚠️ The PDF seems to be empty or contains mostly images. Please ensure it has selectable text.");
      }

      // 4. Save to DB
      setCV(userId, text);
      
      log.info('Resume uploaded via Telegram', { userId, length: text.length });

      return h.send(chatId, 
        `✅ *Resume Stored Successfully!*\n\n` +
        `I've parsed your experience. You can now:\n` +
        `• Send me a **Job URL** to evaluate it\n` +
        `• Use **/jobs** for recommendations\n` +
        `• Ask me career questions!`
      );

    } catch (err) {
      log.error('DOCUMENT ERROR:', { error: err.message, userId });
      return h.send(chatId, "❌ Failed to process document. Please try again.");
    }
  }
};
