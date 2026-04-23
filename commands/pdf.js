import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { generatePDF } from '../lib/pdfGenerator.js';
import { getCV } from '../lib/db.js';
import { callGemini } from '../lib/gemini.js';
import { buildTailorPrompt } from '../lib/prompt-engine.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('pdf')
  .setDescription('📄 Generate ATS-optimized resume PDF (with optional job tailoring)')
  .addStringOption(opt =>
    opt.setName('company')
      .setDescription('Target company name (optional)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('role')
      .setDescription('Target role (optional)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('jd')
      .setDescription('Paste job description for deep tailoring (optional)')
      .setRequired(false)
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  await interaction.deferReply();

  try {
    const cvText = getCV(discordId);
    if (!cvText) {
      return interaction.editReply('❌ No CV on file! Please use `/cv set` to upload your text CV first.');
    }

    const company = interaction.options.getString('company') || 'Company';
    const role = interaction.options.getString('role') || 'Role';
    const jd = interaction.options.getString('jd');

    await interaction.editReply(`📄 **Tailoring your resume for ${role} @ ${company}...**`);

    const systemPrompt = buildTailorPrompt({ cvText, role, company, jd });
    const rawResponse = await callGemini(systemPrompt, `Tailoring resume for ${role} at ${company}`);

    let resumeData;
    try {
      const match = rawResponse.match(/\{[\s\S]*\}/);
      resumeData = JSON.parse(match[0]);
    } catch {
      log.error('[/pdf] JSON parse failed', { rawResponse, discordId });
      throw new Error('Failed to parse AI response. Please try again.');
    }

    const pdfInfo = await generatePDF(resumeData);
    const attachment = new AttachmentBuilder(pdfInfo.path, { name: pdfInfo.filename });

    await interaction.editReply({
      content: `✅ **Resume Ready!** — Tailored for ${role} @ ${company}`,
      files: [attachment]
    });
  } catch (err) {
    log.error('[/pdf] Error:', { error: err.message, discordId });
    await interaction.editReply(`❌ PDF generation failed: ${err.message}`);
  }
}
