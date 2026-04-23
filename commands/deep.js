/**
 * commands/deep.js — /deep command
 *
 * Runs deep company research via Gemini and returns a structured report.
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { upsertUser } from '../lib/db.js';
import { researchCompany } from '../lib/gemini.js';
import { buildDeepResearchPrompt } from '../lib/prompt-engine.js';
import { buildErrorEmbed } from '../lib/embed-builder.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('deep')
  .setDescription('Deep research report on a company')
  .addStringOption(opt =>
    opt.setName('company')
      .setDescription('Company name to research')
      .setRequired(true)
      .setMaxLength(200),
  );

export async function execute(interaction) {
  const discordId   = interaction.user.id;
  const username    = interaction.user.tag;
  const companyName = interaction.options.getString('company');

  upsertUser(discordId, username);
  await interaction.deferReply();

  try {
    const systemPrompt = buildDeepResearchPrompt();
    const report       = await researchCompany({ systemPrompt, companyName });

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🔬 Deep Research — ${companyName}`)
      .setDescription(report.slice(0, 4000))
      .setFooter({ text: 'Wingman · powered by Google Gemini' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

  } catch (err) {
    log.error('[/deep] Error:', { error: err.message, discordId });
    await interaction.editReply({
      embeds: [buildErrorEmbed(`Research failed: ${err.message?.slice(0, 200) || 'Unknown error'}`)],
    });
  }
}
