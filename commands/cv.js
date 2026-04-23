/**
 * commands/cv.js — /cv subcommands
 *
 * Manages the user's CV: set (upload), show, delete.
 * CV is stored in SQLite and used in all evaluation prompts.
 */

import { SlashCommandBuilder } from 'discord.js';
import { upsertUser, setCV, getCV, deleteCV } from '../lib/db.js';
import { buildSuccessEmbed, buildErrorEmbed } from '../lib/embed-builder.js';
import { EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('cv')
  .setDescription('Manage your CV profile')
  .addSubcommand(sub =>
    sub.setName('set')
      .setDescription('Upload your CV as a .txt file')
      .addAttachmentOption(opt =>
        opt.setName('file')
          .setDescription('Your CV as a plain .txt file')
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub.setName('show')
      .setDescription('Show your CV currently on file'),
  )
  .addSubcommand(sub =>
    sub.setName('delete')
      .setDescription('Remove your CV from SME Bot'),
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const username  = interaction.user.tag;
  const sub       = interaction.options.getSubcommand();

  upsertUser(discordId, username);

  if (sub === 'set') {
    const attachment = interaction.options.getAttachment('file');
    await interaction.deferReply({ ephemeral: true });

    if (!attachment.name.endsWith('.txt')) {
      return interaction.editReply({
        embeds: [buildErrorEmbed('Please upload a `.txt` file. Convert your CV to plain text before uploading.')],
      });
    }

    try {
      const res = await fetch(attachment.url);
      if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
      const cvText = await res.text();

      if (!cvText.trim()) {
        return interaction.editReply({ embeds: [buildErrorEmbed('The uploaded file is empty.')] });
      }

      setCV(discordId, cvText);
      await interaction.editReply({
        embeds: [buildSuccessEmbed(
          'CV Saved',
          `Your CV (${cvText.length.toLocaleString()} chars) has been saved.\nRun \`/evaluate\` to test it against a job description.`,
        )],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [buildErrorEmbed(`Failed to save CV: ${err.message}`)] });
    }

  } else if (sub === 'show') {
    await interaction.deferReply({ ephemeral: true });
    const cvText = getCV(discordId);

    if (!cvText) {
      return interaction.editReply({
        embeds: [buildErrorEmbed('No CV on file. Run `/cv set` to upload your CV.')],
      });
    }

    const preview = cvText.slice(0, 3800);
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📄 Your CV on File')
      .setDescription(`\`\`\`\n${preview}\n\`\`\`${cvText.length > 3800 ? '\n*[Truncated for display]*' : ''}`)
      .setFooter({ text: `Total: ${cvText.length.toLocaleString()} characters` });

    await interaction.editReply({ embeds: [embed] });

  } else if (sub === 'delete') {
    deleteCV(discordId);
    await interaction.reply({
      embeds: [buildSuccessEmbed('CV Deleted', 'Your CV has been removed. Future evaluations will use general criteria only.')],
      ephemeral: true,
    });
  }
}
