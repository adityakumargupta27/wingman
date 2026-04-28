/**
 * commands/evaluate.js — /evaluate command
 *
 * AGENT: Elite Recruiter Evaluator
 * INPUT: Job URL or pasted JD text + user's CV
 * OUTPUT: 10-dimension fit score, gaps, strengths, recommendation
 *
 * Uses dedicated buildEvaluationPrompt() as system persona.
 * JD text goes as USER content via evaluateJD().
 *
 * SCRAPER SAFETY: If scraping fails, user gets a clean error message.
 * Playwright errors are NEVER passed to the LLM.
 */

import { SlashCommandBuilder, ThreadAutoArchiveDuration, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { upsertUser, getCV, saveApplication, updateApplicationThread } from '../lib/db.js';
import { evaluateJD } from '../lib/gemini.js';
import { buildEvaluationPrompt } from '../lib/prompt-engine.js';
import { parseScore } from '../lib/score-parser.js';
import { buildEvalEmbed, buildReportChunk, splitReport, buildErrorEmbed } from '../lib/embed-builder.js';
import { fetchJobDescription, ScraperError } from '../lib/scraper.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('evaluate')
  .setDescription('🎯 Evaluate a job description against your CV')
  .addStringOption(opt =>
    opt.setName('url')
      .setDescription('URL of the job posting')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('jd')
      .setDescription('Paste the full job description text here')
      .setRequired(false)
      .setMaxLength(4000)
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const username  = interaction.user.tag;
  let jdText      = interaction.options.getString('jd');
  const url       = interaction.options.getString('url');

  if (!jdText && !url) {
    return interaction.reply({ content: '❌ You must provide either a `url` or `jd` text to evaluate.', ephemeral: true });
  }

  upsertUser(discordId, username);
  await interaction.deferReply();

  try {
    // Step 1: Get JD text (scrape if URL provided)
    if (url && !jdText) {
      await interaction.editReply(`🔍 **Scraping job description...**\nURL: <${url}>`);
      // fetchJobDescription throws ScraperError with clean messages on failure
      const fetched = await fetchJobDescription(url);
      jdText = fetched.text;
      await interaction.editReply(`✅ **Job description scraped!** Now evaluating against your CV...`);
    }

    // Step 2: Build FRESH evaluation context
    const cvText       = await getCV(discordId);
    const systemPrompt = buildEvaluationPrompt(cvText);
    const rawResponse  = await evaluateJD({ systemPrompt, jdText });

    // Step 3: Parse structured output
    const { company, role, score, archetype, legitimacy, stories, rawReport } = parseScore(rawResponse);

    // Step 4: Save to tracker
    const appId = saveApplication({
      discordId,
      company, role, score, archetype, legitimacy,
      jdSnippet: jdText.slice(0, 500),
      reportText: rawReport,
      storiesJson: stories,
    });

    // Step 5: Build premium embed
    const evalEmbed = buildEvalEmbed({ company, role, score, archetype, legitimacy });
    if (url) evalEmbed.setURL(url);

    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`save_story_${appId}`)
          .setLabel('📥 Save Stories')
          .setStyle(ButtonStyle.Success)
          .setDisabled(!stories || stories === 'null'),
        new ButtonBuilder()
          .setCustomId(`reachout_${appId}`)
          .setLabel('💬 Generate Reachout')
          .setStyle(ButtonStyle.Primary)
      );

    const reply = await interaction.editReply({
      content: '',
      embeds: [evalEmbed],
      components: [buttons]
    });

    // Step 6: Create thread for full report
    try {
      const thread = await reply.startThread({
        name: `📋 ${company} — ${role}`.slice(0, 100),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: 'Wingman evaluation report',
      });

      const chunks = splitReport(rawReport);
      for (let i = 0; i < chunks.length; i++) {
        const chunkEmbed = buildReportChunk(chunks[i], i + 1, chunks.length);
        await thread.send({ embeds: [chunkEmbed] });
      }
      updateApplicationThread(appId, thread.id);
    } catch {
      // Thread creation might fail in some channel types — not critical
    }

    // Step 7: Proactive DM for high scores
    const dmThreshold = parseFloat(process.env.DM_SCORE_THRESHOLD || '7.0');
    if (score !== null && score >= dmThreshold) {
      try {
        const user = await interaction.client.users.fetch(discordId);
        await user.send({
          content: `🌟 **Strong match found!** Your evaluation for **${company} — ${role}** scored **${score.toFixed(1)}/10.0**.`,
          embeds: [evalEmbed],
        });
      } catch {
        // DMs may be disabled
      }
    }

  } catch (err) {
    log.error('[/evaluate] Error', { error: err.message, discordId });

    // ScraperError messages are already user-facing and clean
    const userMsg = err instanceof ScraperError
      ? err.message
      : `❌ Evaluation failed:\n\n${err.message?.slice(0, 300) || 'Unknown error'}`;

    await interaction.editReply({ content: '', embeds: [buildErrorEmbed(userMsg)] });
  }
}
