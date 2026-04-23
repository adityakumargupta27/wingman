import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { callGemini } from '../lib/gemini.js';
import { buildProjectPrompt } from '../lib/prompt-engine.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('project')
  .setDescription('🚀 Evaluate a portfolio project idea or existing work')
  .addStringOption(opt =>
    opt.setName('description')
      .setDescription('Describe your project (tech stack, problem solved, features)')
      .setRequired(true)
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const description = interaction.options.getString('description');

  await interaction.deferReply();

  try {
    const systemPrompt = buildProjectPrompt(description);
    const response = await callGemini(systemPrompt, 'Evaluating project');

    const embed = new EmbedBuilder()
      .setTitle('🚀 Project Evaluation Report')
      .setColor(0xFAA61A)
      .setDescription(response.slice(0, 4000))
      .setFooter({ text: 'Wingman Project Mode' });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    log.error('[/project] Error:', { error: err.message, discordId });
    await interaction.editReply(`❌ Project evaluation failed: ${err.message}`);
  }
}
