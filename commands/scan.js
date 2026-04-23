import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { callGemini } from '../lib/gemini.js';
import { getCV } from '../lib/db.js';

export const data = new SlashCommandBuilder()
  .setName('scan')
  .setDescription('🔍 Scan for matching internship opportunities based on your CV')
  .addStringOption(opt =>
    opt.setName('keyword')
      .setDescription('Search keyword e.g. "SDE Intern", "AI Engineer", "Full Stack"')
      .setRequired(false)
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const keyword = interaction.options.getString('keyword') || 'SDE Intern';

  await interaction.deferReply();

  try {
    const cvText = getCV(discordId);
    
    await interaction.editReply(`🔍 **Scanning top portals for "${keyword}"...**`);

    const systemPrompt = `You are an expert job scraper and career wingman. Based on the candidate's CV and the search keyword, suggest 5 realistic, high-quality job opportunities or internships.
    
Focus on remote opportunities or Indian tech companies (Swiggy, Zepto, CRED, Razorpay, etc).
Return ONLY a valid JSON array of objects with keys: "company", "role", "search_url", and "why".
    
Candidate CV:
${cvText ? cvText.slice(0, 2000) : 'General Software Engineer looking for roles'}`;

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
      .setTitle(`🎯 ${results.length} Opportunities Found — "${keyword}"`)
      .setColor(0x0099ff)
      .setDescription('Here are the top matches for your profile. Use `/evaluate` with the JD to get a full analysis.')
      .setFooter({ text: 'Wingman Scanner' });

    for (const result of results.slice(0, 5)) {
      embed.addFields({
        name: `🏢 ${result.company} — ${result.role}`,
        value: `${result.why}\n🔗 [Search Openings](${result.search_url || 'https://google.com'})`,
        inline: false,
      });
    }

    await interaction.editReply({ content: '', embeds: [embed] });
  } catch (err) {
    console.error('[/scan] Error:', err);
    await interaction.editReply(`❌ Scan failed: ${err.message}`);
  }
}
