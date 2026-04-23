import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { generatePDF } from '../lib/pdfGenerator.js';
import { getCV } from '../lib/db.js';

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

    await interaction.editReply(`📄 **Generating tailored ATS resume...**\nTarget: ${role} @ ${company}`);

    const evaluationContext = {
      role: role,
      company: company,
      cv_matches: ['Firebase', 'AI Integration', 'React'], // Dummy
      cover_letter_hook: ''
    };

    const pdfInfo = await generatePDF(evaluationContext, cvText);
    const attachment = new AttachmentBuilder(pdfInfo.path, { name: pdfInfo.filename });

    await interaction.editReply({
      content: `✅ **Resume Ready!** — Tailored for ${role} @ ${company}`,
      files: [attachment]
    });
  } catch (err) {
    console.error('[/pdf] Error:', err);
    await interaction.editReply(`❌ PDF generation failed: ${err.message}`);
  }
}
