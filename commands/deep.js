/**
 * commands/deep.js — /deep command
 *
 * AGENT: Company Intelligence Analyst
 * INPUT: Company name + optional URL for live context
 * OUTPUT: Structured research report (funding, culture, tech stack, red flags, verdict)
 *
 * Uses dedicated buildDeepResearchPrompt() as system persona.
 * Company name and scraped context go as USER content.
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { upsertUser } from '../lib/db.js';
import { researchCompany } from '../lib/gemini.js';
import { buildDeepResearchPrompt } from '../lib/prompt-engine.js';
import { buildErrorEmbed } from '../lib/embed-builder.js';
import { fetchJobDescription, ScraperError } from '../lib/scraper.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('deep')
  .setDescription('🔬 Deep research report on a company')
  .addStringOption(opt =>
    opt.setName('company')
      .setDescription('Company name to research')
      .setRequired(true)
      .setMaxLength(200),
  )
  .addStringOption(opt =>
    opt.setName('url')
      .setDescription('Optional: Company website or job URL for extra context')
      .setRequired(false)
  );

export async function execute(interaction) {
  const discordId   = interaction.user.id;
  const username    = interaction.user.tag;
  const companyName = interaction.options.getString('company');
  const url         = interaction.options.getString('url');

  upsertUser(discordId, username);
  await interaction.deferReply();

  try {
    // Optionally scrape URL for live context (non-fatal if it fails)
    let userContent = companyName;
    if (url) {
      try {
        await interaction.editReply(`🔍 Scraping context from: <${url}>`);
        const fetched = await fetchJobDescription(url);
        userContent = `${companyName}\n\nEXTRA CONTEXT FROM ${url}:\n${fetched.text.slice(0, 5000)}`;
      } catch (err) {
        log.warn('[/deep] Context scraping failed (non-fatal)', { url, error: err.message });
      }
    }

    // System = analyst persona (static), User = company + context (dynamic)
    const systemPrompt = buildDeepResearchPrompt();
    const report = await researchCompany({ systemPrompt, companyName: userContent });

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🔬 Deep Research — ${companyName}`)
      .setDescription(report.slice(0, 4000))
      .setFooter({ text: 'Wingman AI · Company Intelligence' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

  } catch (err) {
    log.error('[/deep] Error', { error: err.message, discordId });
    await interaction.editReply({
      embeds: [buildErrorEmbed(`Research failed: ${err.message?.slice(0, 200) || 'Unknown error'}`)],
    });
  }
}
