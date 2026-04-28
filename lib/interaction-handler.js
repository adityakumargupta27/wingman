/**
 * lib/interaction-handler.js — Handle button and component interactions
 */

import { getApplication, addStory, addToPipeline, getUser, getCV } from './db.js';
import { fetchAtsJobs } from './portals.js';
import { callGemini } from './gemini.js';
import { autoApply } from './auto-apply.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import log from './logger.js';

export async function handleButton(interaction) {
  const { customId, user } = interaction;
  const discordId = user.id;

  // ── Save Story Interaction ──────────────────────────────────────────────────
  if (customId.startsWith('save_story_')) {
    const appId = customId.replace('save_story_', '');
    await interaction.deferReply({ ephemeral: true });

    try {
      const app = getApplication(appId);
      if (!app || !app.stories_json) {
        return interaction.editReply('❌ No stories found to save.');
      }

      // stories_json contains the raw STAR+R text suggested by Gemini.
      // We'll use Gemini one last time to split them into distinct stories and save them.
      const prompt = `
        You are a data extractor. Extract the STAR+R stories from the text below.
        Return ONLY a JSON array of objects.
        Each object MUST have: "title", "category", "content" (the full STAR+R text).
        
        TEXT TO PARSE:
        ${app.stories_json}
      `;

      const response = await callGemini(prompt, 'Story Extraction');
      let stories = [];
      try {
        const match = response.match(/\[[\s\S]*\]/);
        if (match) stories = JSON.parse(match[0]);
      } catch (err) {
        log.error('Failed to parse stories JSON', { error: err.message, response });
        return interaction.editReply('❌ Failed to extract structured stories.');
      }

      for (const s of stories) {
        addStory(discordId, s.title, s.category, s.content);
      }

      await interaction.editReply(`✅ Successfully saved **${stories.length} stories** to your /story bank!`);
    } catch (err) {
      log.error('Button interaction error (save_story)', { error: err.message });
      await interaction.editReply('❌ An error occurred while saving stories.');
    }
  }

  // ── Reachout Interaction ────────────────────────────────────────────────────
  if (customId.startsWith('reachout_')) {
    const appId = customId.replace('reachout_', '');
    await interaction.deferReply({ ephemeral: true });

    try {
      const app = getApplication(appId);
      if (!app) return interaction.editReply('❌ Application not found.');

      const prompt = `
        You are an elite career coach. Generate a high-conversion cold outreach message for the following role.
        The message should be tailored to the candidate's archetype and mention why they are a strong fit.
        
        COMPANY: ${app.company}
        ROLE: ${app.role}
        ARCHETYPE: ${app.archetype}
        SCORE: ${app.score}/10.0
        
        Return two options:
        1. LinkedIn Connection Request (under 300 chars)
        2. Professional Email / InMail (under 1000 chars)
      `;

      const reachoutText = await callGemini(prompt, 'Reachout Generation');
      await interaction.editReply({
        content: `💬 **Reachout Drafts for ${app.company}**\n\n${reachoutText}`
      });
    } catch (err) {
      log.error('Button interaction error (reachout)', { error: err.message });
      await interaction.editReply('❌ An error occurred while generating reachout.');
    }
  }

  // ── Bulk Evaluation Interaction ─────────────────────────────────────────────
  if (customId.startsWith('bulk_eval_')) {
    const parts = customId.split('_');
    const type  = parts[2];
    const id    = parts[3];
    await interaction.deferReply({ ephemeral: true });

    try {
      const jobs = await fetchAtsJobs(type, id);
      if (!jobs.length) return interaction.editReply('❌ No jobs found to evaluate.');

      for (const job of jobs) {
        addToPipeline(discordId, job.url, `Bulk scan from ${id} (${type})`);
      }

      await interaction.editReply(`🚀 Successfully queued **${jobs.length} roles** for background evaluation. You'll receive DMs for strong matches!`);
    } catch (err) {
      log.error('Button interaction error (bulk_eval)', { error: err.message });
      await interaction.editReply('❌ An error occurred while queuing jobs.');
    }
  }

  // ── Match Feed (Swipe) Interaction ─────────────────────────────────────────
  if (customId.startsWith('swipe_')) {
    const parts  = customId.split('_');
    const action = parts[1]; // pass, apply, next
    const index  = parseInt(parts[2]);
    const type   = parts[3];
    const id     = parts[4];

    await interaction.deferUpdate();

    try {
      const jobs = await fetchAtsJobs(type, id);
      const nextIndex = index + 1;

      if (action === 'apply') {
        const user = getUser(discordId);
        const job  = jobs[index];
        await interaction.followUp({ content: `🚀 **Auto-Applying to ${job.title}...**`, ephemeral: true });
        
        try {
          await autoApply(job.url, {
            name: user.username,
            email: user.email || 'aditya@example.com', // Fallback for demo
            linkedin: user.preferences?.linkedin || 'linkedin.com/in/adityagupta',
            github: user.preferences?.github || 'github.com/adityagupta'
          });
          await interaction.followUp({ content: `✅ **Applied to ${job.title}!** (Form filled)`, ephemeral: true });
        } catch (err) {
          await interaction.followUp({ content: `❌ Auto-apply failed: ${err.message}`, ephemeral: true });
        }
      }

      if (nextIndex >= jobs.length) {
        return interaction.editReply({ content: '🏁 **You\'ve reached the end of the feed!**', embeds: [], components: [] });
      }

      const nextJob = jobs[nextIndex];
      const buttons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`swipe_pass_${nextIndex}_${type}_${id}`)
            .setLabel('⬅️ Pass')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`swipe_apply_${nextIndex}_${type}_${id}`)
            .setLabel('🚀 Apply')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`swipe_next_${nextIndex}_${type}_${id}`)
            .setLabel('➡️ Next')
            .setStyle(ButtonStyle.Primary)
        );

      const jobEmbed = new EmbedBuilder()
        .setTitle(`${nextJob.title} @ ${id.toUpperCase()}`)
        .setColor(0x5865F2)
        .setDescription(`📍 ${nextJob.location}\n\n**Match Score:** Analyzing...\nUse the buttons below to "Swipe" through roles.`)
        .addFields({ name: 'Role Index', value: `${nextIndex + 1} of ${jobs.length}`, inline: true })
        .setFooter({ text: 'Wingman Match Feed' });

      await interaction.editReply({ embeds: [jobEmbed], components: [buttons] });
    } catch (err) {
      log.error('Swipe interaction error', { error: err.message });
    }
  }
}
