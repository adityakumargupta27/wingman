import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { callGemini } from '../lib/gemini.js';
import { getCV } from '../lib/db.js';
import { buildScanPrompt } from '../lib/prompt-engine.js';
import { fetchAtsJobs } from '../lib/portals.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('scan')
  .setDescription('🔍 Scan for opportunities (Discovery or Direct ATS)')
  .addSubcommand(sub =>
    sub.setName('discovery')
      .setDescription('AI-powered search for new opportunities')
      .addStringOption(opt => opt.setName('keyword').setDescription('Search keyword').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('portal')
      .setDescription('Directly scan a company board (Greenhouse/Lever)')
      .addStringOption(opt => opt.setName('type').setDescription('greenhouse or lever').setRequired(true).addChoices(
        { name: 'Greenhouse', value: 'greenhouse' },
        { name: 'Lever', value: 'lever' }
      ))
      .addStringOption(opt => opt.setName('id').setDescription('Company board ID (e.g. "openai" or "stripe")').setRequired(true))
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  await interaction.deferReply();

  const sub = interaction.options.getSubcommand();

  if (sub === 'portal') {
    const type = interaction.options.getString('type');
    const id   = interaction.options.getString('id');
    
    try {
      const jobs = await fetchAtsJobs(type, id);
      if (!jobs.length) return interaction.editReply(`❌ No jobs found on ${type} board: **${id}**`);

      const buttons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`swipe_pass_0_${type}_${id}`)
            .setLabel('⬅️ Pass')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`swipe_apply_0_${type}_${id}`)
            .setLabel('🚀 Apply')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`swipe_next_0_${type}_${id}`)
            .setLabel('➡️ Next')
            .setStyle(ButtonStyle.Primary)
        );

      const job = jobs[0];
      const jobEmbed = new EmbedBuilder()
        .setTitle(`${job.title} @ ${id.toUpperCase()}`)
        .setColor(0x5865F2)
        .setDescription(`📍 ${job.location}\n\n**Match Score:** Analyzing...\nUse the buttons below to "Swipe" through roles.`)
        .addFields({ name: 'Role Index', value: `1 of ${jobs.length}`, inline: true })
        .setFooter({ text: 'Wingman Match Feed' });

      await interaction.editReply({ embeds: [jobEmbed], components: [buttons] });
    } catch (err) {
      log.error('[/scan portal] Error:', { error: err.message, discordId });
      await interaction.editReply(`❌ Portal scan failed: ${err.message}`);
    }
    return;
  }

  // Discovery logic (existing)
  try {
    const keyword = interaction.options.getString('keyword') || 'SDE Intern';
    const cvText = getCV(discordId);
    
    await interaction.editReply(`🔍 **Scanning for "${keyword}" using AI discovery...**`);

    const systemPrompt = buildScanPrompt(cvText, keyword);
    const rawResponse = await callGemini(systemPrompt, `Keyword: ${keyword}`);
    
    let results = [];
    try {
      const match = rawResponse.match(/\[[\s\S]*\]/);
      if (match) results = JSON.parse(match[0]);
    } catch {
      return interaction.editReply('❌ Failed to parse scan results.');
    }

    if (!results || results.length === 0) {
      return interaction.editReply('😔 No results found. Try a different keyword.');
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎯 ${results.length} Discovery Matches — "${keyword}"`)
      .setColor(0x0099ff)
      .setDescription('Top matches found via web discovery.')
      .setFooter({ text: 'Wingman Discovery' });

    for (const result of results.slice(0, 5)) {
      embed.addFields({
        name: `🏢 ${result.company} — ${result.role}`,
        value: `${result.why}\n🔗 [Search Openings](${result.search_url || 'https://google.com'})`,
        inline: false,
      });
    }

    await interaction.editReply({ content: '', embeds: [embed] });
  } catch (err) {
    log.error('[/scan discovery] Error:', { error: err.message, discordId });
    await interaction.editReply(`❌ Discovery failed: ${err.message}`);
  }
}
