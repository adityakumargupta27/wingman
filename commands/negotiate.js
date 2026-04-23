import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('negotiate')
  .setDescription('💰 Salary negotiation scripts and stipend ranges');

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('💰 Salary Negotiation Scripts — Wingman Playbook')
    .setColor(0xffd700)
    .addFields(
      {
        name: '🎯 Internship Stipend Ranges (India 2026)',
        value: [
          '🏢 FAANG (Google, Amazon, Meta): ₹80,000–1,20,000/month',
          '🦄 Unicorns (Swiggy, Razorpay, CRED): ₹40,000–80,000/month',
          '🚀 Series B/C Startups: ₹20,000–50,000/month',
          '🌱 Early Stage / Small: ₹10,000–25,000/month',
          '🌍 Remote Global (USD): $2,000–5,000/month',
        ].join('\n'),
        inline: false,
      },
      {
        name: '💬 Script: When They Give First Offer',
        value: [
          '*"Thank you for the offer! I\'m genuinely excited about the role. I was expecting something in the range of ₹[X-Y] based on my research and the value I bring — is there flexibility here?"*',
          '',
          '**Tips:**',
          '• Always get the first number from them if possible',
          '• Use silence after asking — let them respond',
          '• Counter 20-30% above your minimum',
          '• Ask about PPO (Pre-Placement Offer) early',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🚫 Never Say',
        value: '• "I need the money" (makes you negotiation-weak)\n• "My minimum is..." (gives away your floor)\n• "I\'ll take whatever" (signals low confidence)',
        inline: false,
      },
      {
        name: '✅ Always Ask',
        value: '• Is there a PPO at end of internship?\n• What\'s the tech stack / team size?\n• Will I work on production features?\n• Remote/hybrid policy after internship?',
        inline: false,
      },
    )
    .setFooter({ text: 'Wingman Negotiate • Know your worth. Ask for it.' });

  await interaction.reply({ embeds: [embed] });
}
