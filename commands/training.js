import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getCV } from '../lib/db.js';
import { callGemini } from '../lib/gemini.js';
import { buildTrainingPrompt } from '../lib/prompt-engine.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('training')
  .setDescription('🎓 Generate a skill-gap roadmap for a target role')
  .addStringOption(opt =>
    opt.setName('role')
      .setDescription('Target role (e.g. "Senior Backend Engineer")')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('type')
      .setDescription('Company type (e.g. "AI Startup", "FAANG")')
      .setRequired(false)
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const role = interaction.options.getString('role');
  const type = interaction.options.getString('type') || 'Tech Company';

  await interaction.deferReply();

  try {
    const cvText = getCV(discordId);
    if (!cvText) return interaction.editReply('❌ Please upload your CV first using `/cv set`.');

    const systemPrompt = buildTrainingPrompt(cvText, role, type);
    const response = await callGemini(systemPrompt, `Roadmap for ${role}`);

    const embed = new EmbedBuilder()
      .setTitle(`🎓 Learning Roadmap: ${role}`)
      .setColor(0xEB459E)
      .setDescription(response.slice(0, 4000))
      .setFooter({ text: 'Wingman Training Mode' });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    log.error('[/training] Error:', { error: err.message, discordId });
    await interaction.editReply(`❌ Training roadmap generation failed: ${err.message}`);
  }
}
