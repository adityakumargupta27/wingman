/**
 * commands/email.js — Email Scanning & Discovery
 */

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { addToPipeline, getGmailToken } from '../lib/db.js';
import { getAuthUrl, scanInbox, setRefreshToken } from '../lib/gmail.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('email')
  .setDescription('📬 Real-time Email Sync (Gmail/Outlook)')
  .addSubcommand(sub =>
    sub.setName('sync')
      .setDescription('Scan your real inbox for new opportunities')
  )
  .addSubcommand(sub =>
    sub.setName('auth')
      .setDescription('Authorize Wingman to access your job alerts')
      .addStringOption(opt => opt.setName('code').setDescription('Enter the code from the Google auth page').setRequired(false))
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'auth') {
    const code = interaction.options.getString('code');
    if (!code) {
      const url = getAuthUrl();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('🔗 Authorize Google').setStyle(ButtonStyle.Link).setURL(url)
      );
      return interaction.reply({
        content: '🔐 **Step 1: Authorization Required**\n1. Click the button below to sign in.\n2. Copy the code from the success page.\n3. Run `/email auth code:YOUR_CODE`',
        components: [row],
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      await setRefreshToken(discordId, code);
      return interaction.editReply('✅ **Authorized!** You can now run `/email sync` to scan your inbox.');
    } catch (err) {
      return interaction.editReply(`❌ Authorization failed: ${err.message}`);
    }
  }

  if (subcommand === 'sync') {
    await interaction.deferReply({ ephemeral: true });

    try {
      const jobs = await scanInbox(discordId);

      if (!jobs.length) {
        return interaction.editReply('📬 No new job alerts or opportunities found in your recent emails.');
      }

      const embed = new EmbedBuilder()
        .setTitle('📬 Real Email Discovery Result')
        .setColor(0x00FF00)
        .setDescription(`I've scanned your **real inbox** and found **${jobs.length} opportunities**!`)
        .setFooter({ text: 'Phase 1: Real-time Onboarding' });

      for (const job of jobs.slice(0, 5)) {
        embed.addFields({
          name: `🏢 New Discovery`,
          value: `🔗 [View Role](${job.url})\n📄 *Snippet: ${job.snippet.slice(0, 100)}...*`,
          inline: false
        });
        addToPipeline(discordId, job.url, `Discovered via Real Email Sync`);
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      if (err.message === 'NOT_AUTHORIZED') {
        return interaction.editReply('🔐 You haven\'t authorized your email yet! Use `/email auth` first.');
      }
      log.error('Email sync error', { error: err.message });
      await interaction.editReply(`❌ Sync failed: ${err.message}`);
    }
  }
}
