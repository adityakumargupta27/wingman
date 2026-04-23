/**
 * lib/embed-builder.js — Discord Embed factory for SME Bot
 *
 * Converts Gemini evaluation output into rich, readable Discord embeds.
 * Handles Discord's 4096-char field limit by splitting long content.
 */

import { EmbedBuilder } from 'discord.js';
import { scoreEmoji, scoreBar, recommendation } from './score-parser.js';

// Brand colors
const COLORS = {
  success:  0x57F287,  // green
  warning:  0xFEE75C,  // yellow
  danger:   0xED4245,  // red
  info:     0x5865F2,  // blurple
  neutral:  0x2F3136,  // dark
};

function scoreColor(score) {
  if (score === null) return COLORS.neutral;
  if (score >= 4.0)   return COLORS.success;
  if (score >= 3.0)   return COLORS.warning;
  return COLORS.danger;
}

/**
 * Build the main evaluation embed.
 */
export function buildEvalEmbed({ company, role, score, archetype, legitimacy }) {
  const emoji = scoreEmoji(score);
  const bar   = scoreBar(score);
  const rec   = recommendation(score);
  const scoreDisplay = score !== null ? `${score.toFixed(1)} / 5.0` : '? / 5.0';

  return new EmbedBuilder()
    .setColor(scoreColor(score))
    .setTitle(`🎯 Job Evaluation — ${company}`)
    .setDescription(`**${role}**`)
    .addFields(
      { name: '📊 Score',        value: `${emoji}  **${scoreDisplay}**\n\`${bar}\``, inline: true },
      { name: '🏷️ Archetype',   value: archetype,  inline: true },
      { name: '🔍 Legitimacy',   value: legitimacy, inline: true },
      { name: '💡 Recommendation', value: rec, inline: false },
    )
    .setFooter({ text: 'SME Bot · powered by Google Gemini' })
    .setTimestamp();
}

/**
 * Build a report chunk embed (for threading long reports).
 * Discord max embed description: 4096 chars.
 */
export function buildReportChunk(content, index, total) {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setDescription(content.slice(0, 4000))
    .setFooter({ text: `Part ${index} of ${total}` });
}

/**
 * Split a long report into ≤4000-char chunks.
 * Splits at paragraph boundaries where possible.
 */
export function splitReport(text, chunkSize = 3800) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > chunkSize) {
    // Try to split at a double-newline (paragraph boundary)
    let splitAt = remaining.lastIndexOf('\n\n', chunkSize);
    if (splitAt === -1 || splitAt < chunkSize / 2) {
      // Fall back to single newline
      splitAt = remaining.lastIndexOf('\n', chunkSize);
    }
    if (splitAt === -1) {
      // Hard cut
      splitAt = chunkSize;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Build the tracker embed showing a user's recent applications.
 */
export function buildTrackerEmbed(applications, username) {
  if (!applications.length) {
    return new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('📋 Application Tracker')
      .setDescription(`No applications yet, ${username}.\nRun \`/evaluate\` to start tracking!`);
  }

  const STATUS_EMOJI = {
    'Evaluated':  '🔵',
    'Applied':    '📤',
    'Interview':  '🎤',
    'Offer':      '🎉',
    'Rejected':   '❌',
    'Withdrawn':  '⏹️',
  };

  const rows = applications.map(a => {
    const emoji = STATUS_EMOJI[a.status] || '🔘';
    const score = a.score !== null ? a.score.toFixed(1) : '?';
    const date  = new Date(a.evaluated_at * 1000).toISOString().split('T')[0];
    return `${emoji} **#${a.id}** | ${a.company} — ${a.role}\n    Score: \`${score}/5\` · Status: ${a.status} · ${date}`;
  });

  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('📋 Application Tracker')
    .setDescription(rows.join('\n\n').slice(0, 4000))
    .setFooter({ text: `Showing last ${applications.length} applications · Use /tracker update <id> <status> to update` });
}

/**
 * Build a simple error embed.
 */
export function buildErrorEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle('❌ Error')
    .setDescription(message)
    .setFooter({ text: 'SME Bot' });
}

/**
 * Build a success embed.
 */
export function buildSuccessEmbed(title, message) {
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`✅ ${title}`)
    .setDescription(message)
    .setFooter({ text: 'SME Bot' });
}

/**
 * Build the help embed.
 */
export function buildHelpEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('🤖 SME Bot — Career Intelligence Assistant')
    .setDescription('Powered by Google Gemini · Inspired by [career-ops](https://github.com/santifer/career-ops)')
    .addFields(
      {
        name: '📋 Evaluation',
        value: [
          '`/evaluate [jd_text]` — Score a job description (A-F, 10 dimensions)',
          '`/evaluate-file` — Upload a .txt JD file for evaluation',
          '`/score-summary` — Your last 5 evaluation scores',
        ].join('\n'),
      },
      {
        name: '👤 Your Profile',
        value: [
          '`/cv set` — Upload your CV (attach .txt file)',
          '`/cv show` — Display your CV on file',
          '`/cv delete` — Remove your CV',
        ].join('\n'),
      },
      {
        name: '🗂️ Tracker',
        value: [
          '`/tracker` — View your application pipeline',
          '`/tracker update [id] [status]` — Update application status',
        ].join('\n'),
      },
      {
        name: '🔬 Research',
        value: [
          '`/deep [company]` — Deep company research report',
          '`/interview [role]` — Generate 10 interview questions',
        ].join('\n'),
      },
      {
        name: '📊 Application Statuses',
        value: '`Evaluated` → `Applied` → `Interview` → `Offer` / `Rejected` / `Withdrawn`',
      },
    )
    .setFooter({ text: 'SME Bot · Use /evaluate to get started' });
}
