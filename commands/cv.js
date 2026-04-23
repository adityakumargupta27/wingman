/**
 * commands/cv.js — /cv subcommands
 *
 * Manages the user's CV: set (upload), show, delete.
 * CV is stored in SQLite and used in all evaluation prompts.
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { upsertUser, setCV, getCV, deleteCV } from '../lib/db.js';
import { buildSuccessEmbed, buildErrorEmbed } from '../lib/embed-builder.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import axios from 'axios';

export const data = new SlashCommandBuilder()
  .setName('cv')
  .setDescription('Manage your CV profile')
  .addSubcommand(sub =>
    sub.setName('set')
      .setDescription('Upload your CV as .pdf')
      .addAttachmentOption(opt =>
        opt.setName('file')
          .setDescription('Your CV (PDF only)')
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub.setName('show')
      .setDescription('Show your CV currently on file'),
  )
  .addSubcommand(sub =>
    sub.setName('delete')
      .setDescription('Remove your CV from Wingman'),
  );

export async function execute(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const discordId = interaction.user.id;
    const username  = interaction.user.tag;
    const sub       = interaction.options.getSubcommand();

    upsertUser(discordId, username);

    if (sub === 'set') {
      const attachment = interaction.options.getAttachment('file');

      let cvText = '';

      try {
        if (attachment.name.toLowerCase().endsWith('.pdf')) {
          const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
          const data = await pdf(response.data);
          cvText = data.text;
        } else {
          return interaction.editReply({
            embeds: [buildErrorEmbed('Only `.pdf` files are supported for CV uploads.')],
          });
        }

        if (!cvText || !cvText.trim()) {
          return interaction.editReply({ embeds: [buildErrorEmbed('The uploaded file is empty or could not be parsed.')] });
        }

        setCV(discordId, cvText);
        await interaction.editReply({
          embeds: [buildSuccessEmbed(
            'CV Saved',
            `Your CV (${cvText.length.toLocaleString()} chars) has been parsed and saved.\nRun \`/evaluate\` to test it against a job description.`,
          )],
        });
      } catch (err) {
        await interaction.editReply({ embeds: [buildErrorEmbed(`Failed to save CV: ${err.message}`)] });
      }

    } else if (sub === 'show') {
      const cvText = await getCV(discordId);

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
      await interaction.editReply({
        embeds: [buildSuccessEmbed('CV Deleted', 'Your CV has been removed. Future evaluations will use general criteria only.')],
      });
    }
  } catch (err) {
    console.error("FATAL CV COMMAND ERROR:", err);
    throw err;
  }
}


