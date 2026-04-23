/**
 * index.js — SME Bot entry point
 *
 * Initializes the Discord client, loads all commands from /commands/,
 * and routes slash command interactions.
 *
 * Usage:
 *   node index.js          (production)
 *   node --watch index.js  (development, auto-restarts)
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// ── Validate required env vars ────────────────────────────────────────────────

const REQUIRED_ENV = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'GEMINI_API_KEY'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌  Missing required environment variables: ${missing.join(', ')}`);
  console.error('    Copy .env.example → .env and fill in your values.');
  process.exit(1);
}

// ── Discord client ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

// ── Load commands ─────────────────────────────────────────────────────────────

client.commands = new Collection();

const commandFiles = readdirSync(join(ROOT, 'commands')).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = await import(`./commands/${file}`);
  if (!command.data || !command.execute) {
    console.warn(`⚠️  Skipping ${file} — missing data or execute export`);
    continue;
  }
  client.commands.set(command.data.name, command);
  console.log(`📦  Loaded command: /${command.data.name}`);
}

// ── Event: Ready ──────────────────────────────────────────────────────────────

client.once(Events.ClientReady, (c) => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║              SME Bot is online 🤖                   ║
║   Logged in as: ${c.user.tag.padEnd(34)}║
║   Commands: ${String(client.commands.size).padEnd(38)}║
╚══════════════════════════════════════════════════════╝
  `);
});

// ── Event: Interaction ────────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.warn(`⚠️  Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[/${interaction.commandName}] Unhandled error:`, err);
    const msg = { content: '❌ An unexpected error occurred. Please try again.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

client.login(process.env.DISCORD_TOKEN);
