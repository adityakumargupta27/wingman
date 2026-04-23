/**
 * commands/help.js — /help command
 *
 * Shows all available commands with descriptions.
 */

import { SlashCommandBuilder } from 'discord.js';
import { buildHelpEmbed } from '../lib/embed-builder.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all Wingman commands');

export async function execute(interaction) {
  await interaction.reply({ embeds: [buildHelpEmbed()], ephemeral: true });
}
