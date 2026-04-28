/**
 * index.js — Wingman entry point
 *
 * Production-grade Discord bot entrypoint with:
 *   - Global uncaught exception / rejection handlers
 *   - Structured logging
 *   - Per-command rate limiting
 *   - Health check HTTP server for container orchestrators
 *   - Graceful shutdown with connection draining
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Events, Partials } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkRateLimit, rateLimitMessage } from './lib/rate-limiter.js';
import { startHealthServer, setReady } from './lib/health.js';
import { startPipelineWorker } from './lib/pipeline.js';
import { startScoutService } from './lib/scout.js';
import { handleButton } from './lib/interaction-handler.js';
import { startTelegramBot } from './lib/telegram.js';
import log from './lib/logger.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

// ── Validate required env vars ────────────────────────────────────────────────

const REQUIRED_ENV = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'GEMINI_API_KEY'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌  Missing required environment variables: ${missing.join(', ')}`);
  console.error('    Copy .env.example → .env and fill in your values.');
  process.exit(1);
}

// ── Global crash protection ──────────────────────────────────────────────────
// These handlers ensure the process NEVER dies from an unhandled error.
// PM2 / Docker will restart if something truly fatal happens.

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception — process surviving', {
    error: err.message,
    stack: err.stack?.slice(0, 500),
  });
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection — process surviving', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack?.slice(0, 500) : undefined,
  });
});

// ── Discord client ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel],
});

// ── Load commands ─────────────────────────────────────────────────────────────

client.commands = new Collection();

const commandFiles = readdirSync(join(ROOT, 'commands')).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  try {
    const command = await import(`./commands/${file}`);
    if (!command.data || !command.execute) {
      log.warn(`Skipping ${file} — missing data or execute export`);
      continue;
    }
    client.commands.set(command.data.name, command);
    log.info(`Loaded command: /${command.data.name}`);
  } catch (err) {
    log.error(`Failed to load command: ${file}`, { error: err.message });
  }
}

// ── Rate limit config per command ─────────────────────────────────────────────
// Heavy commands (AI calls) get stricter limits than lightweight ones.

const COMMAND_LIMITS = {
  evaluate:       { max: 3,  window: 60_000 },
  'evaluate-file': { max: 3,  window: 60_000 },
  scan:           { max: 3,  window: 60_000 },
  deep:           { max: 3,  window: 60_000 },
  interview:      { max: 3,  window: 60_000 },
  pdf:            { max: 2,  window: 60_000 },
  // Light commands — default limits apply
};

// ── Event: Ready ──────────────────────────────────────────────────────────────

client.once(Events.ClientReady, (c) => {
  log.info('Wingman is online', {
    tag: c.user.tag,
    commands: client.commands.size,
    guilds: c.guilds.cache.size,
  });

  console.log(`
╔══════════════════════════════════════════════════════╗
║              Wingman is online 🛫                    ║
║   Logged in as: ${c.user.tag.padEnd(34)}║
║   Commands: ${String(client.commands.size).padEnd(38)}║
║   Guilds: ${String(c.guilds.cache.size).padEnd(40)}║
╚══════════════════════════════════════════════════════╝
  `);

  c.user.setPresence({
    activities: [{ name: '/evaluate · /scan · /pdf', type: 0 }],
    status: 'online',
  });

  setReady(true);
});

// ── Event: Interaction ────────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    return handleButton(interaction);
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    log.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }

  // ── Rate limit check ──────────────────────────────────────────────────────
  const limits = COMMAND_LIMITS[interaction.commandName] || {};
  const { allowed, retryAfterMs } = checkRateLimit(
    interaction.user.id,
    limits.max,
    limits.window,
  );

  if (!allowed) {
    return interaction.reply({
      content: rateLimitMessage(retryAfterMs),
      ephemeral: true,
    }).catch(() => {});
  }

  // ── Execute with crash protection ─────────────────────────────────────────
  const startMs = performance.now();

  try {
    await command.execute(interaction);
    const durationMs = Math.round(performance.now() - startMs);
    log.info(`Command completed`, {
      command: interaction.commandName,
      user: interaction.user.tag,
      durationMs,
    });
  } catch (err) {
    const durationMs = Math.round(performance.now() - startMs);
    log.error(`Command failed`, {
      command: interaction.commandName,
      user: interaction.user.tag,
      error: err.message,
      stack: err.stack?.slice(0, 300),
      durationMs,
    });

    // Always try to respond to the user — never leave them hanging
    const msg = {
      content: '❌ An unexpected error occurred. Please try again.',
      ephemeral: true,
    };

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    } catch {
      // Interaction expired or already handled — nothing we can do
    }
  }
});

// ── Auto-reconnect on disconnect ──────────────────────────────────────────────

client.on(Events.Error, (err) => {
  log.error('Discord client error', { error: err.message });
});

client.on('shardDisconnect', (event, shardId) => {
  log.warn('Shard disconnected', { shardId, code: event?.code });
  setReady(false);
});

client.on('shardReconnecting', (shardId) => {
  log.info('Shard reconnecting', { shardId });
});

client.on('shardReady', (shardId) => {
  log.info('Shard ready', { shardId });
  setReady(true);
});

// ── Event: Natural Language Routing ───────────────────────────────────────────

import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content) return;

  // Simple routing for common natural language triggers
  const content = message.content.toLowerCase();
  
  if (content.includes('evaluate') || content.includes('check this') || content.match(/https?:\/\/[^\s]+/)) {
    const urlMatch = message.content.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const url = urlMatch[0];
      await message.reply(`🤖 **Natural Language Detected:** "I'll evaluate that job for you!"`);
      const evaluateCommand = client.commands.get('evaluate');
      // Create a mock interaction-like object for execute()
      const mockInteraction = {
        user: message.author,
        options: { getString: () => url },
        reply: (msg) => message.reply(msg),
        deferReply: () => message.channel.sendTyping(),
        editReply: (msg) => message.reply(msg),
        followUp: (msg) => message.reply(msg),
        guildId: message.guildId,
      };
      return evaluateCommand.execute(mockInteraction);
    }
  }

  if (content === 'hello' || content === 'hi' || content === 'hey bot') {
    return message.reply("👋 **Hey there!** I'm Wingman, your career assistant. You can talk to me normally, or use `/help` to see what I can do!");
  }
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  log.info(`${signal} received — shutting down gracefully`);
  setReady(false);

  // Give in-flight requests 5 seconds to complete
  setTimeout(() => {
    client.destroy();
    process.exit(0);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Start ─────────────────────────────────────────────────────────────────────

startHealthServer();
startPipelineWorker(client);
startScoutService(client);
startTelegramBot();
client.login(process.env.DISCORD_TOKEN);
