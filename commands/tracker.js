/**
 * commands/tracker.js — /tracker subcommands
 *
 * View application pipeline and update statuses.
 */

import { SlashCommandBuilder } from 'discord.js';
import { upsertUser, getUserApplications, updateApplicationStatus } from '../lib/db.js';
import { buildTrackerEmbed, buildSuccessEmbed, buildErrorEmbed } from '../lib/embed-builder.js';

const VALID_STATUSES = ['Evaluated', 'Applied', 'Interview', 'Offer', 'Rejected', 'Withdrawn'];

export const data = new SlashCommandBuilder()
  .setName('tracker')
  .setDescription('Manage your application tracker')
  .addSubcommand(sub =>
    sub.setName('view')
      .setDescription('View your recent applications'),
  )
  .addSubcommand(sub =>
    sub.setName('update')
      .setDescription('Update an application status')
      .addIntegerOption(opt =>
        opt.setName('id')
          .setDescription('Application ID (from /tracker view)')
          .setRequired(true)
          .setMinValue(1),
      )
      .addStringOption(opt =>
        opt.setName('status')
          .setDescription('New status')
          .setRequired(true)
          .addChoices(
            ...VALID_STATUSES.map(s => ({ name: s, value: s })),
          ),
      ),
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const username  = interaction.user.tag;
  const sub       = interaction.options.getSubcommand();

  upsertUser(discordId, username);

  if (sub === 'view') {
    const apps  = getUserApplications(discordId, 10);
    const embed = buildTrackerEmbed(apps, username);
    await interaction.reply({ embeds: [embed], ephemeral: true });

  } else if (sub === 'update') {
    const id     = interaction.options.getInteger('id');
    const status = interaction.options.getString('status');
    const ok     = updateApplicationStatus(id, discordId, status);

    if (ok) {
      await interaction.reply({
        embeds: [buildSuccessEmbed('Tracker Updated', `Application #${id} status → **${status}**`)],
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        embeds: [buildErrorEmbed(`Application #${id} not found or doesn't belong to you.`)],
        ephemeral: true,
      });
    }
  }
}
