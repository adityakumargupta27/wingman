/**
 * commands/evaluate.js — /evaluate command
 *
 * Evaluates a job description against the user's saved CV.
 * Accepts either a pasted text JD or a URL (which it scrapes using Playwright).
 * Creates a thread for the full report, sends a summary embed inline.
 */

import { SlashCommandBuilder, ThreadAutoArchiveDuration, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { upsertUser, getCV, saveApplication, updateApplicationThread } from '../lib/db.js';
import { evaluateJD } from '../lib/gemini.js';
import { buildEvaluationPrompt } from '../lib/prompt-engine.js';
import { parseScore } from '../lib/score-parser.js';
import { buildEvalEmbed, buildReportChunk, splitReport, buildErrorEmbed } from '../lib/embed-builder.js';
import { fetchJobDescription } from '../lib/scraper.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('evaluate')
  .setDescription('Evaluate a job description against your CV')
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

  // Ensure user row exists
  upsertUser(discordId, username);

  // Defer reply — scraping + Gemini can take 30-60s
  await interaction.deferReply();

  try {
    if (url) {
      await interaction.editReply(`🔍 **Scraping job description...**\nURL: <${url}>`);
      const fetched = await fetchJobDescription(url);
      if (fetched.text.startsWith('Could not fetch page')) {
         return interaction.editReply({ embeds: [buildErrorEmbed(fetched.text)] });
      }
      jdText = fetched.text;
      await interaction.editReply(`✅ **Job description scraped!** Now evaluating against your CV...`);
    }

    const cvText       = await getCV(discordId);
    const systemPrompt = buildEvaluationPrompt(cvText);
    const rawResponse  = await evaluateJD({ systemPrompt, jdText });
    const { company, role, score, archetype, legitimacy, stories, rawReport } = parseScore(rawResponse);

    // Save to tracker
    const appId = saveApplication({
      discordId,
      company,
      role,
      score,
      archetype,
      legitimacy,
      jdSnippet: jdText.slice(0, 500),
      reportText: rawReport,
      storiesJson: stories,
    });

    // Send summary embed with buttons
    const evalEmbed = buildEvalEmbed({ company, role, score, archetype, legitimacy });
    if (url) {
        evalEmbed.setURL(url);
    }

    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`save_story_${appId}`)
          .setLabel('📥 Save Stories to Bank')
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

    // Create thread for the full report
    let threadId = null;
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
      threadId = thread.id;
      updateApplicationThread(appId, threadId);
    } catch {
      // Thread creation might fail in some channel types — not critical
    }

    // Proactive DM for high scores
    const dmThreshold = parseFloat(process.env.DM_SCORE_THRESHOLD || '4.0');
    if (score !== null && score >= dmThreshold) {
      try {
        const user = await interaction.client.users.fetch(discordId);
        await user.send({
          content: `🌟 **Strong match found!** Your evaluation for **${company} — ${role}** scored **${score.toFixed(1)}/5.0**.`,
          embeds: [evalEmbed],
        });
      } catch {
        // DMs may be disabled — silently ignore
      }
    }

  } catch (err) {
    log.error('[/evaluate] Error:', { error: err.message, discordId });

    const errMsg = `❌ Evaluation failed:\n\n${err.stack?.slice(0, 500) || err.message || 'Unknown error'}`;

    await interaction.editReply({ content: '', embeds: [buildErrorEmbed(errMsg)] });
  }
}
