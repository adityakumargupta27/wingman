/**
 * deploy-commands.js — Register slash commands with Discord API
 *
 * Run once (or after adding new commands) to register slash commands.
 *
 * Usage:
 *   node deploy-commands.js                    # Global (1 hour propagation)
 *   DISCORD_DEV_GUILD_ID=... node deploy-commands.js  # Guild (instant)
 */

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_DEV_GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('❌  DISCORD_TOKEN and DISCORD_CLIENT_ID are required in .env');
  process.exit(1);
}

// ── Collect command definitions ───────────────────────────────────────────────

const commands = [];
const commandFiles = readdirSync(join(ROOT, 'commands')).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = await import(`./commands/${file}`);
  if (command.data) {
    commands.push(command.data.toJSON());
    console.log(`📦  Queued: /${command.data.name}`);
  }
}

// ── Register with Discord API ─────────────────────────────────────────────────

const rest = new REST().setToken(DISCORD_TOKEN);

try {
  console.log(`\n🚀  Registering ${commands.length} slash command(s)...`);

  let data;
  if (DISCORD_DEV_GUILD_ID) {
    // Guild registration — instant
    data = await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_DEV_GUILD_ID),
      { body: commands },
    );
    console.log(`✅  Registered ${data.length} command(s) to guild ${DISCORD_DEV_GUILD_ID} (instant)`);
  } else {
    // Global registration — up to 1 hour
    data = await rest.put(
      Routes.applicationCommands(DISCORD_CLIENT_ID),
      { body: commands },
    );
    console.log(`✅  Registered ${data.length} command(s) globally (may take up to 1 hour)`);
  }

} catch (err) {
  console.error('❌  Failed to register commands:', err);
  process.exit(1);
}
