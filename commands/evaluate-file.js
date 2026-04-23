/**
 * commands/evaluate-file.js — /evaluate-file command
 *
 * Accepts a .txt file attachment containing the full JD text.
 * Useful for JDs longer than Discord's 4000-char option limit.
 */

import { SlashCommandBuilder } from 'discord.js';
import { upsertUser, getCV, saveApplication } from '../lib/db.js';
import { evaluateJD } from '../lib/gemini.js';
import { buildEvaluationPrompt } from '../lib/prompt-engine.js';
import { parseScore } from '../lib/score-parser.js';
import { buildEvalEmbed, buildReportChunk, splitReport, buildErrorEmbed } from '../lib/embed-builder.js';

export const data = new SlashCommandBuilder()
  .setName('evaluate-file')
  .setDescription('Evaluate a job description from an uploaded .txt file')
  .addAttachmentOption(opt =>
    opt.setName('jd_file')
      .setDescription('Upload a .txt file containing the job description')
      .setRequired(true),
  );

export async function execute(interaction) {
  const discordId  = interaction.user.id;
  const username   = interaction.user.tag;
  const attachment = interaction.options.getAttachment('jd_file');

  upsertUser(discordId, username);
  await interaction.deferReply();

  try {
    // Validate file type
    if (!attachment.name.endsWith('.txt')) {
      return interaction.editReply({
        embeds: [buildErrorEmbed('Please upload a `.txt` file containing the job description.')],
      });
    }

    // Fetch file content (Discord CDN URL)
    const res = await fetch(attachment.url);
    if (!res.ok) throw new Error(`Failed to fetch attachment: ${res.status}`);
    const jdText = await res.text();

    if (!jdText.trim()) {
      return interaction.editReply({
        embeds: [buildErrorEmbed('The uploaded file appears to be empty.')],
      });
    }

    const cvText       = getCV(discordId);
    const systemPrompt = buildEvaluationPrompt(cvText);
    const rawResponse  = await evaluateJD({ systemPrompt, jdText });
    const { company, role, score, archetype, legitimacy, rawReport } = parseScore(rawResponse);

    const evalEmbed = buildEvalEmbed({ company, role, score, archetype, legitimacy });
    const reply     = await interaction.editReply({ embeds: [evalEmbed] });

    let threadId = null;
    try {
      const thread = await reply.startThread({
        name: `📋 ${company} — ${role}`.slice(0, 100),
        autoArchiveDuration: 1440,
        reason: 'Wingman evaluation report',
      });
      const chunks = splitReport(rawReport);
      for (let i = 0; i < chunks.length; i++) {
        await thread.send({ embeds: [buildReportChunk(chunks[i], i + 1, chunks.length)] });
      }
      threadId = thread.id;
    } catch { /* ignore thread errors */ }

    saveApplication({
      discordId, company, role, score, archetype, legitimacy,
      jdSnippet: jdText.slice(0, 500),
      reportText: rawReport,
      threadId,
    });

  } catch (err) {
    console.error('[/evaluate-file] Error:', err);
    await interaction.editReply({
      embeds: [buildErrorEmbed(`Evaluation failed: ${err.message?.slice(0, 200) || 'Unknown error'}`)],
    });
  }
}
