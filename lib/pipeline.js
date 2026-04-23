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

/**
 * Start the pipeline worker.
 */
export function startPipelineWorker() {
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
      const { company, role, score, archetype, legitimacy, rawReport } = parseScore(rawResponse);

      saveApplication({
        discordId: item.discord_id,
        company,
        role,
        score,
        archetype,
        legitimacy,
        jdSnippet: jdText.slice(0, 500),
        reportText: rawReport,
        threadId: null // We don't create threads in batch mode automatically
      });

      updatePipelineStatus(item.id, 'completed');
      log.info('Pipeline item completed', { id: item.id, company, role });

    } catch (err) {
      log.error('Pipeline item failed', { id: item.id, error: err.message });
      updatePipelineStatus(item.id, 'failed', err.message);
    }
  }

  isProcessing = false;
}
