/**
 * commands/project.js — /project command
 *
 * AGENT: Project DNA Analyst
 * INPUT: Project description or GitHub URL (user message)
 * OUTPUT: Complexity score, hidden skills, resume bullets, interview talking points
 *
 * Uses dedicated buildProjectPrompt() as system persona.
 * Project description goes as USER content — never in system prompt.
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { analyzeProject } from '../lib/gemini.js';
import { buildProjectPrompt } from '../lib/prompt-engine.js';
import { buildErrorEmbed } from '../lib/embed-builder.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('project')
  .setDescription('🚀 Analyze a portfolio project — extract hidden skills and resume bullets')
  .addStringOption(opt =>
    opt.setName('description')
      .setDescription('Describe your project or paste a GitHub URL')
      .setRequired(true)
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const description = interaction.options.getString('description');

  await interaction.deferReply();

  try {
    // System prompt = FAANG hiring manager persona (static)
    // User content = the actual project description (dynamic)
    const systemPrompt = buildProjectPrompt();
    const response = await analyzeProject({ systemPrompt, description });

    const embed = new EmbedBuilder()
      .setTitle('🚀 Project DNA Analysis')
      .setColor(0xFAA61A)
      .setDescription(response.slice(0, 4000))
      .setFooter({ text: 'Wingman AI · Project Intelligence' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    log.error('[/project] Error', { error: err.message, discordId });
    await interaction.editReply({
      embeds: [buildErrorEmbed(`Project analysis failed: ${err.message?.slice(0, 200) || 'Unknown error'}`)],
    });
  }
}
