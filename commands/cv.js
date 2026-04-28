/**
 * commands/cv.js — /cv subcommands
 *
 * AGENT: Resume Manager + ATS Tailor Specialist
 * Manages CV: set (upload PDF), show, delete, tailor
 *
 * The tailor subcommand uses a SEPARATE AI agent (tailorResume)
 * with its own dedicated system prompt.
 */

import { SlashCommandBuilder, EmbedBuilder, ThreadAutoArchiveDuration } from 'discord.js';
import { upsertUser, setCV, getCV, deleteCV } from '../lib/db.js';
import { buildSuccessEmbed, buildErrorEmbed, splitReport, buildReportChunk } from '../lib/embed-builder.js';
import { fetchJobDescription, ScraperError } from '../lib/scraper.js';
import { buildTailorPrompt } from '../lib/prompt-engine.js';
import { tailorResume } from '../lib/gemini.js';
import { createRequire } from 'module';
import log from '../lib/logger.js';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse/lib/pdf-parse.js');
import axios from 'axios';

export const data = new SlashCommandBuilder()
  .setName('cv')
  .setDescription('Manage your CV profile')
  .addSubcommand(sub =>
    sub.setName('set')
      .setDescription('Upload your CV as PDF')
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
  )
  .addSubcommand(sub =>
    sub.setName('tailor')
      .setDescription('Generate a tailored version of your resume for a JD')
      .addStringOption(opt =>
        opt.setName('url')
          .setDescription('URL of the job posting')
          .setRequired(false)
      )
      .addStringOption(opt =>
        opt.setName('jd')
          .setDescription('Paste job description text')
          .setRequired(false)
          .setMaxLength(4000)
      )
  );

export async function execute(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const discordId = interaction.user.id;
    const username  = interaction.user.tag;
    const sub       = interaction.options.getSubcommand();

    upsertUser(discordId, username);

    // ── DETERMINISTIC ROUTING ──────────────────────────────────────────────
    switch (sub) {
      case 'set':
        return await handleSet(interaction, discordId);
      case 'show':
        return await handleShow(interaction, discordId);
      case 'delete':
        return await handleDelete(interaction, discordId);
      case 'tailor':
        return await handleTailor(interaction, discordId);
      default:
        return interaction.editReply({ embeds: [buildErrorEmbed('Unknown subcommand.')] });
    }
  } catch (err) {
    log.error('[/cv] Fatal error', { error: err.message });
    try {
      await interaction.editReply({ embeds: [buildErrorEmbed(`CV command failed: ${err.message?.slice(0, 200)}`)] });
    } catch {}
  }
}

async function handleSet(interaction, discordId) {
  const attachment = interaction.options.getAttachment('file');

  if (!attachment.name.toLowerCase().endsWith('.pdf')) {
    return interaction.editReply({
      embeds: [buildErrorEmbed('Only `.pdf` files are supported for CV uploads.')],
    });
  }

  const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
  const data = await pdf(response.data);
  const cvText = data.text;

  if (!cvText || !cvText.trim()) {
    return interaction.editReply({
      embeds: [buildErrorEmbed('Could not extract text from this PDF. It may be scanned/image-based.')],
    });
  }

  setCV(discordId, cvText);
  await interaction.editReply({
    embeds: [buildSuccessEmbed(
      'CV Saved',
      `Your CV (${cvText.length.toLocaleString()} chars) has been parsed and saved.\nRun \`/evaluate\` to test it against a job description.`,
    )],
  });
}

async function handleShow(interaction, discordId) {
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
}

async function handleDelete(interaction, discordId) {
  deleteCV(discordId);
  await interaction.editReply({
    embeds: [buildSuccessEmbed('CV Deleted', 'Your CV has been removed. Future evaluations will use general criteria only.')],
  });
}

async function handleTailor(interaction, discordId) {
  const cvText = await getCV(discordId);
  if (!cvText) {
    return interaction.editReply({ embeds: [buildErrorEmbed('No CV on file. Please run `/cv set` first.')] });
  }

  let jdText = interaction.options.getString('jd');
  const url   = interaction.options.getString('url');

  if (!jdText && !url) {
    return interaction.editReply({ embeds: [buildErrorEmbed('Provide either a `url` or `jd` text to tailor against.')] });
  }

  // Scrape URL if provided
  if (url) {
    try {
      const fetched = await fetchJobDescription(url);
      jdText = fetched.text;
    } catch (err) {
      const msg = err instanceof ScraperError ? err.message : `Scraping failed: ${err.message}`;
      return interaction.editReply({ embeds: [buildErrorEmbed(msg)] });
    }
  }

  // ISOLATED: Tailor agent — JD in system context, CV as user content
  const systemPrompt = buildTailorPrompt({ role: 'Target Role', company: 'Target Company', jd: jdText });
  const tailoredText = await tailorResume({ systemPrompt, cvText });

  const embed = new EmbedBuilder()
    .setColor(0xFAA61A)
    .setTitle('📄 Tailored CV Ready')
    .setDescription('Check the thread below for the full tailored content.')
    .setFooter({ text: 'Wingman AI · Resume Tailoring' });

  const reply = await interaction.editReply({ embeds: [embed] });

  try {
    const thread = await reply.startThread({
      name: `📄 Tailored CV — ${new Date().toLocaleDateString()}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    });

    const chunks = splitReport(tailoredText);
    for (let i = 0; i < chunks.length; i++) {
      await thread.send({ embeds: [buildReportChunk(chunks[i], i + 1, chunks.length)] });
    }
  } catch {
    // Thread creation might fail in DMs
    await interaction.followUp({ content: tailoredText.slice(0, 2000), ephemeral: true });
  }
}
