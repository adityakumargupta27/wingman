/**
 * lib/scout.js — Autonomous Career Scout
 * 
 * Background service that:
 * 1. Scans Gmail for new job alerts.
 * 2. Scans target job portals.
 * 3. Expands search roles using AI.
 * 4. Automatically evaluates and notifies the user.
 */

import { scanInbox } from './gmail.js';
import { fetchJobDescription } from './scraper.js';
import { evaluateJD } from './gemini.js';
import { buildEvaluationPrompt } from './prompt-engine.js';
import { parseScore } from './score-parser.js';
import { saveApplication, getCV, getUsersWithGmail } from './db.js';
import log from './logger.js';

let scoutTimer = null;

export function startScoutService(client) {
  log.info('Autonomous Scout Service starting...');
  // Run every hour
  scoutTimer = setInterval(() => runScout(client), 60 * 60 * 1000);
  // Run once immediately (after 10s delay to let system settle)
  setTimeout(() => runScout(client), 10000);
}

async function runScout(client) {
  log.info('Running autonomous scout cycle');
  
  const users = getUsersWithGmail();
  for (const user of users) {
    try {
      log.info(`Scouting for user ${user.username}`);
      
      // 1. Scan Gmail for job snippets
      const jobs = await scanInbox(user.discord_id);
      if (!jobs.length) continue;

      const cvText = getCV(user.discord_id);
      if (!cvText) continue;

      for (const job of jobs) {
        try {
          // 2. Scrape full JD if we have a URL
          let jdText = job.snippet;
          if (job.url) {
            const fetched = await fetchJobDescription(job.url);
            jdText = fetched.text;
          }

          // 3. AI Evaluation
          const systemPrompt = buildEvaluationPrompt(cvText);
          const rawResponse = await evaluateJD({ systemPrompt, jdText });
          const { company, role, score, archetype, legitimacy, stories, rawReport } = parseScore(rawResponse);

          // 4. Save to Tracker
          const appId = saveApplication({
            discordId: user.discord_id,
            company,
            role,
            score,
            archetype,
            legitimacy,
            jdSnippet: jdText.slice(0, 500),
            reportText: rawReport,
            storiesJson: stories,
          });

          // 5. Proactive Notification for High Scores
          if (score >= 7.0) {
            const discordUser = await client.users.fetch(user.discord_id);
            await discordUser.send({
              content: `🚀 **Autonomous Scout Found a Match!**\nI found a **${role}** at **${company}** that matches your profile **${score.toFixed(1)}/10.0**. Check your tracker!`,
            });
          }
        } catch (jobErr) {
          log.warn(`Scout failed for specific job: ${jobErr.message}`);
        }
      }
    } catch (userErr) {
      log.error(`Scout cycle failed for user ${user.username}`, { error: userErr.message });
    }
  }
}
