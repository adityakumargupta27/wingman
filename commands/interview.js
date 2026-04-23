/**
 * commands/interview.js — /interview command
 *
 * Generates 10 targeted interview questions for a given role,
 * tailored to the user's CV.
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { upsertUser, getCV } from '../lib/db.js';
import { generateInterviewQuestions } from '../lib/gemini.js';
import { buildInterviewPrepPrompt } from '../lib/prompt-engine.js';
import { buildErrorEmbed } from '../lib/embed-builder.js';

export const data = new SlashCommandBuilder()
  .setName('interview')
  .setDescription('Generate 10 interview questions for a role')
  .addStringOption(opt =>
    opt.setName('role')
      .setDescription('Role title (e.g. "Senior AI Engineer")')
      .setRequired(true)
      .setMaxLength(200),
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const username  = interaction.user.tag;
  const role      = interaction.options.getString('role');

  upsertUser(discordId, username);
  await interaction.deferReply({ ephemeral: true });

  try {
    const cvText       = getCV(discordId);
    const systemPrompt = buildInterviewPrepPrompt(cvText);
    const questions    = await generateInterviewQuestions({ systemPrompt, role });

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle(`🎤 Interview Prep — ${role}`)
      .setDescription(questions.slice(0, 4000))
      .setFooter({ text: 'SME Bot · Study these, then practice out loud!' });

    await interaction.editReply({ embeds: [embed] });

  } catch (err) {
    console.error('[/interview] Error:', err);
    await interaction.editReply({
      embeds: [buildErrorEmbed(`Interview prep failed: ${err.message?.slice(0, 200) || 'Unknown error'}`)],
    });
  }
}
