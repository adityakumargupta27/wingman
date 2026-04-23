/**
 * lib/pipeline.js — Batch processing orchestrator
 * 
 * Manages the background evaluation of multiple job URLs.
 * Uses a polling mechanism to process pending items from the database.
 */

import { getPendingPipeline, updatePipelineStatus, getCV, saveApplication } from './db.js';
import { fetchJobDescription } from './scraper.js';
import { evaluateJD } from './gemini.js';
import { buildEvaluationPrompt } from './prompt-engine.js';
import { parseScore } from './score-parser.js';
import log from './logger.js';

let isProcessing = false;
let discordClient = null;

/**
 * Start the pipeline worker.
 */
export function startPipelineWorker(client) {
  discordClient = client;
  log.info('Pipeline worker started');
  setInterval(processNext, 30000); // Check every 30 seconds
}

async function processNext() {
  if (isProcessing) return;
  
  const pending = getPendingPipeline();
  if (!pending.length) return;

  isProcessing = true;
  log.info(`Processing pipeline batch of ${pending.length}`);

  for (const item of pending) {
    try {
      updatePipelineStatus(item.id, 'processing');
      
      const cvText = getCV(item.discord_id);
      if (!cvText) throw new Error('No CV found for user');

      const fetched = await fetchJobDescription(item.url);
      const jdText = fetched.text;

      const systemPrompt = buildEvaluationPrompt(cvText);
      const rawResponse = await evaluateJD({ systemPrompt, jdText });
      const { company, role, score, archetype, legitimacy, stories, rawReport } = parseScore(rawResponse);

      saveApplication({
        discordId: item.discord_id,
        company,
        role,
        score,
        archetype,
        legitimacy,
        jdSnippet: jdText.slice(0, 500),
        reportText: rawReport,
        storiesJson: stories,
        threadId: null
      });

      updatePipelineStatus(item.id, 'completed');
      log.info('Pipeline item completed', { id: item.id, company, role });

      // Notify user if score is high
      if (score >= 4.0 && discordClient) {
         try {
           const user = await discordClient.users.fetch(item.discord_id);
           await user.send({
             content: `🚀 **Pipeline Match!** I evaluated **${company} — ${role}** in the background and it scored a **${score.toFixed(1)}/5.0**. Check your tracker!`,
           });
         } catch (e) {
           log.warn('Failed to DM user from pipeline', { userId: item.discord_id, error: e.message });
         }
      }

    } catch (err) {
      log.error('Pipeline item failed', { id: item.id, error: err.message });
      updatePipelineStatus(item.id, 'failed', err.message);
    }
  }

  isProcessing = false;
}
