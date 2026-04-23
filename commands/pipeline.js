import { SlashCommandBuilder } from 'discord.js';
import { addToPipeline } from '../lib/db.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('pipeline')
  .setDescription('🚀 Add jobs to the background batch processing pipeline')
  .addStringOption(opt =>
    opt.setName('urls')
      .setDescription('Paste one or more job URLs (space or comma separated)')
      .setRequired(true)
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const urlsText  = interaction.options.getString('urls');
  
  // Simple regex to find URLs
  const urls = urlsText.match(/https?:\/\/[^\s,]+/g) || [];

  if (!urls.length) {
    return interaction.reply({ content: '❌ No valid URLs found in your input.', ephemeral: true });
  }

  for (const url of urls) {
    addToPipeline(discordId, url);
  }

  await interaction.reply({
    content: `🚀 Added **${urls.length}** jobs to the processing pipeline. Use \`/tracker view\` to check status later.`,
    ephemeral: true
  });
  
  log.info('Jobs added to pipeline', { discordId, count: urls.length });
}
