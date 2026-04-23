/**
 * commands/score-summary.js — /score-summary command
 *
 * Shows the user's last 5 evaluation scores as a quick overview.
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { upsertUser, getUserApplications } from '../lib/db.js';
import { scoreEmoji, scoreBar } from '../lib/score-parser.js';

export const data = new SlashCommandBuilder()
  .setName('score-summary')
  .setDescription('Show your last 5 evaluation scores');

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const username  = interaction.user.tag;

  upsertUser(discordId, username);

  const apps = getUserApplications(discordId, 5);

  if (!apps.length) {
    return interaction.reply({
      content: 'No evaluations yet. Run `/evaluate` to get started!',
      ephemeral: true,
    });
  }

  const rows = apps.map(a => {
    const emoji = scoreEmoji(a.score);
    const bar   = scoreBar(a.score);
    const score = a.score !== null ? a.score.toFixed(1) : '?';
    const date  = new Date(a.evaluated_at * 1000).toISOString().split('T')[0];
    return {
      name: `${emoji} ${a.company} — ${a.role}`.slice(0, 100),
      value: `\`${score}/5\` \`${bar}\`\nStatus: ${a.status} · ${date}`,
      inline: false,
    };
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📊 Your Recent Scores')
    .addFields(rows)
    .setFooter({ text: 'Use /tracker for full pipeline view' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
