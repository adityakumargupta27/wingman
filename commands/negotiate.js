import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { callGemini } from '../lib/gemini.js';
import { buildNegotiationPrompt } from '../lib/prompt-engine.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('negotiate')
  .setDescription('💰 Get a tailored salary negotiation script')
  .addStringOption(opt =>
    opt.setName('company')
      .setDescription('Company name (e.g. Google, Swiggy, Zepto)')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('role')
      .setDescription('Role name (e.g. SDE Intern, Backend Engineer)')
      .setRequired(true)
  );

export async function execute(interaction) {
  const company = interaction.options.getString('company');
  const role    = interaction.options.getString('role');
  const discordId = interaction.user.id;

  await interaction.deferReply();

  try {
    const systemPrompt = buildNegotiationPrompt(role, company);
    const response = await callGemini(systemPrompt, `Negotiating for ${role} at ${company}`);

    const embed = new EmbedBuilder()
      .setTitle(`💰 Negotiation Strategy: ${company}`)
      .setColor(0xffd700)
      .setDescription(response.slice(0, 4000))
      .setFooter({ text: 'Wingman • Know your worth. Ask for it.' });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    log.error('[/negotiate] Error:', { error: err.message, discordId });
    await interaction.editReply(`❌ Failed to generate negotiation script: ${err.message}`);
  }
}
