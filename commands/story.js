import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { addStory, getStories, deleteStory } from '../lib/db.js';
import log from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('story')
  .setDescription('📚 Manage your STAR+R Interview Story Bank')
  .addSubcommand(sub =>
    sub.setName('add')
      .setDescription('Add a new story to your bank')
      .addStringOption(opt => opt.setName('title').setDescription('Short title for the story').setRequired(true))
      .addStringOption(opt => opt.setName('category').setDescription('e.g. Leadership, Technical, Conflict').setRequired(true))
      .addStringOption(opt => opt.setName('content').setDescription('The story in STAR+R format').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('list')
      .setDescription('List all your saved stories')
  )
  .addSubcommand(sub =>
    sub.setName('delete')
      .setDescription('Delete a story by ID')
      .addIntegerOption(opt => opt.setName('id').setDescription('The ID of the story').setRequired(true))
  );

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    const title = interaction.options.getString('title');
    const category = interaction.options.getString('category');
    const content = interaction.options.getString('content');

    addStory(discordId, title, category, content);
    return interaction.reply({ content: `✅ Story **"${title}"** added to your bank!`, ephemeral: true });
  }

  if (sub === 'list') {
    const stories = getStories(discordId);
    if (!stories.length) return interaction.reply({ content: '📚 Your story bank is empty! Use `/story add` to build your repertoire.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle('📚 Your STAR+R Story Bank')
      .setColor(0x57F287)
      .setDescription('Use these stories during your interviews. They are categorized by competency.');

    stories.forEach(s => {
      embed.addFields({
        name: `ID: ${s.id} | ${s.title} [${s.category}]`,
        value: s.story_text.slice(0, 100) + (s.story_text.length > 100 ? '...' : ''),
        inline: false
      });
    });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'delete') {
    const id = interaction.options.getInteger('id');
    deleteStory(id, discordId);
    return interaction.reply({ content: `🗑️ Story **#${id}** deleted.`, ephemeral: true });
  }
}
