/**
 * commands/jobs.js — /jobs slash command for Discord
 *
 * Real job recommendations powered by the Fit Scoring Engine.
 * Fetches from ingested ATS data, scores against user profile,
 * and returns ranked results with explainability.
 *
 * Subcommands:
 *   /jobs                — Get personalized recommendations
 *   /jobs filter:<text>  — Filter by keyword (e.g. "frontend", "remote")
 *   /jobs saved          — View saved jobs
 *   /jobs refresh        — Force re-score recommendations
 */

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getCV, upsertUser } from '../lib/db.js';
import {
  getCandidateProfile, upsertCandidateProfile,
  getActiveJobs, saveRecommendations, getUserRecommendations,
  getSavedJobs, recordFeedback, getJobCount,
} from '../lib/job-db.js';
import { buildCandidateProfile, rankJobs, filterJobs, filterRemoteOnly } from '../lib/job-engine.js';
import { runIngestionCycle } from '../lib/job-scheduler.js';
import { buildErrorEmbed } from '../lib/embed-builder.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('jobs')
  .setDescription('🏹 Smart job recommendations based on your profile')
  .addStringOption(opt =>
    opt.setName('filter')
      .setDescription('Filter by keyword: frontend, remote, intern, python, etc.')
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('saved')
      .setDescription('Show your saved jobs instead')
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('refresh')
      .setDescription('Force re-fetch and re-score all jobs')
      .setRequired(false)
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const username  = interaction.user.tag;
  const filter    = interaction.options.getString('filter');
  const showSaved = interaction.options.getBoolean('saved');
  const refresh   = interaction.options.getBoolean('refresh');

  upsertUser(discordId, username);
  await interaction.deferReply();

  try {
    // ── Show Saved Jobs ──────────────────────────────────────────────────
    if (showSaved) {
      const saved = getSavedJobs(discordId, 10);
      if (!saved.length) {
        return interaction.editReply({ embeds: [buildInfoEmbed('No saved jobs yet', 'Use the 💾 Save button on job recommendations to save jobs.')] });
      }

      const embed = new EmbedBuilder()
        .setTitle('💾 Your Saved Jobs')
        .setColor(0x57F287)
        .setDescription(saved.map((j, i) => {
          return `**${i + 1}. ${j.company} — ${j.title}**\n📊 Fit: ${(j.fit_score * 10).toFixed(0)}% · 📍 ${j.location}\n🔗 [Apply](${j.url})`;
        }).join('\n\n'))
        .setFooter({ text: `${saved.length} saved jobs` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── Build/Get Candidate Profile ──────────────────────────────────────
    const cvText = await getCV(discordId);
    let profile = getCandidateProfile(discordId);

    if (!profile || !cvText) {
      // Auto-build from CV
      if (cvText) {
        profile = buildCandidateProfile(cvText);
        upsertCandidateProfile(discordId, profile);
      } else {
        // No CV — use defaults
        profile = buildCandidateProfile('');
      }
    }

    // ── Force Refresh ────────────────────────────────────────────────────
    if (refresh) {
      await interaction.editReply('🔄 Refreshing job database... this may take a minute.');
      await runIngestionCycle();
    }

    // ── Get & Score Jobs ─────────────────────────────────────────────────
    let jobs = getActiveJobs(2000);
    const totalJobs = jobs.length;

    if (totalJobs === 0) {
      await interaction.editReply('📡 No jobs in database yet. Fetching for the first time...');
      await runIngestionCycle();
      jobs = getActiveJobs(2000);

      if (jobs.length === 0) {
        return interaction.editReply({ embeds: [buildErrorEmbed('No jobs available right now. The job sources may be temporarily unavailable. Try again later.')] });
      }
    }

    // Apply filters
    if (filter) {
      const filterLower = filter.toLowerCase();
      if (filterLower === 'remote') {
        jobs = filterRemoteOnly(jobs);
      } else {
        jobs = filterJobs(jobs, filter);
      }

      if (jobs.length === 0) {
        return interaction.editReply({ embeds: [buildInfoEmbed(`No jobs matching "${filter}"`, `Try a different keyword. Available filters: frontend, backend, fullstack, remote, intern, python, react, etc.`)] });
      }
    }

    // Score and rank
    const ranked = rankJobs(jobs, profile, 10);

    if (ranked.length === 0) {
      return interaction.editReply({ embeds: [buildInfoEmbed('No matches found', 'Upload your CV with `/cv set` for better recommendations, or try `/jobs filter:remote`')] });
    }

    // Save recommendations for feedback tracking
    saveRecommendations(discordId, ranked.filter(r => r.job.id));

    // ── Build Response ───────────────────────────────────────────────────
    const embed = new EmbedBuilder()
      .setTitle(`🏹 Job Matches${filter ? ` — "${filter}"` : ''}`)
      .setColor(0x5865F2)
      .setDescription(
        ranked.slice(0, 7).map((r, i) => {
          const pct = Math.round(r.score * 10);
          const bar = scoreBar(pct);
          const emoji = pct >= 70 ? '🟢' : pct >= 50 ? '🟡' : '🟠';

          let line = `${emoji} **${i + 1}. ${r.job.company} — ${r.job.title}**\n`;
          line += `${bar} ${pct}% Fit · 📍 ${r.job.location}`;

          if (r.reasons.length > 0) {
            line += `\n✅ ${r.reasons[0]}`;
          }
          if (r.gaps.length > 0) {
            line += `\n⚠️ ${r.gaps[0]}`;
          }

          if (r.job.url) {
            line += `\n🔗 [Apply](${r.job.url})`;
          }

          return line;
        }).join('\n\n')
      )
      .setFooter({ text: `Scored ${totalJobs} jobs · Your level: ${profile.level} · Skills: ${profile.skills.slice(0, 5).join(', ')}` })
      .setTimestamp();

    // Action buttons
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('jobs_more')
        .setLabel('🔄 More Jobs')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('jobs_remote')
        .setLabel('🌍 Remote Only')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('jobs_refresh')
        .setLabel('📡 Refresh')
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.editReply({ content: '', embeds: [embed], components: [buttons] });

  } catch (err) {
    log.error('[/jobs] Error', { error: err.message, discordId });
    await interaction.editReply({
      embeds: [buildErrorEmbed(`Job search failed: ${err.message?.slice(0, 200)}`)],
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreBar(pct) {
  const filled = Math.round(pct / 10);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, 10 - filled));
}

function buildInfoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description);
}
