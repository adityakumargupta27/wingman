/**
 * index.js — Wingman entry point
 *
 * Production-grade entry point with:
 *   - Health server starts FIRST (before any validation)
 *   - Graceful degradation if env vars are missing
 *   - Global crash protection
 *   - Structured logging
 *   - Per-command rate limiting
 *   - Graceful shutdown with connection draining
 *   - Independent Telegram + Discord operation
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
import { startJobScheduler } from './lib/job-scheduler.js';
import { handleButton } from './lib/interaction-handler.js';
import { startTelegramBot } from './lib/telegram.js';
import log from './lib/logger.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

// ══════════════════════════════════════════════════════════════════════════════
// STEP 1: Start Health Server IMMEDIATELY
// This must happen before ANY validation so Railway/Docker can see the process.
// ══════════════════════════════════════════════════════════════════════════════

startHealthServer();

// ══════════════════════════════════════════════════════════════════════════════
// STEP 2: Global Crash Protection
// These handlers ensure the process NEVER dies from an unhandled error.
// PM2 / Docker will restart if something truly fatal happens.
// ══════════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════════
// STEP 3: Start Telegram (independent of Discord)
// Telegram only needs TELEGRAM_TOKEN. It starts regardless of Discord status.
// ══════════════════════════════════════════════════════════════════════════════

import { handlers as tgHandlers } from './lib/telegram-handlers.js';
startTelegramBot(tgHandlers);

// ══════════════════════════════════════════════════════════════════════════════
// STEP 4: Validate Discord env vars (non-fatal)
// If Discord vars are missing, we log the error but keep running for Telegram.
// ══════════════════════════════════════════════════════════════════════════════

const DISCORD_REQUIRED = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'];
const GENERAL_REQUIRED = ['OPENAI_API_KEY'];

const missingDiscord = DISCORD_REQUIRED.filter(k => !process.env[k]);
const missingGeneral = GENERAL_REQUIRED.filter(k => !process.env[k]);

if (missingGeneral.length) {
  log.error('Missing general environment variables', { missing: missingGeneral });
  console.error(`\n⚠️  Missing: ${missingGeneral.join(', ')}`);
  console.error('    AI features will be disabled.\n');
}

if (missingDiscord.length) {
  log.warn('Missing Discord environment variables — Discord bot will NOT start', { missing: missingDiscord });
  console.error(`\n⚠️  Missing: ${missingDiscord.join(', ')}`);
  console.error('    Discord bot is disabled. Telegram bot may still be running.\n');
} else {
  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5: Discord Client Setup
  // Only runs if Discord env vars are present.
  // ══════════════════════════════════════════════════════════════════════════

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ],
    partials: [Partials.Channel],
  });

  // ── Load commands ───────────────────────────────────────────────────────

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

  // ── Rate limit config per command ───────────────────────────────────────

  const COMMAND_LIMITS = {
    evaluate:        { max: 3, window: 60_000 },
    'evaluate-file': { max: 3, window: 60_000 },
    scan:            { max: 3, window: 60_000 },
    deep:            { max: 3, window: 60_000 },
    interview:       { max: 3, window: 60_000 },
    pdf:             { max: 2, window: 60_000 },
    project:         { max: 3, window: 60_000 },
  };

  // ── Event: Ready ────────────────────────────────────────────────────────

  client.once(Events.ClientReady, (c) => {
    log.info('Wingman Discord bot is online', {
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

  // ── Event: Interaction ──────────────────────────────────────────────────

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

    // Rate limit check
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

    // Execute with crash protection — one command failure never kills the bot
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
        // Interaction expired or already handled
      }
    }
  });

  // ── Auto-reconnect ──────────────────────────────────────────────────────

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

  // ── Graceful shutdown ───────────────────────────────────────────────────

  function shutdown(signal) {
    log.info(`${signal} received — shutting down gracefully`);
    setReady(false);

    setTimeout(() => {
      client.destroy();
      process.exit(0);
    }, 5000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // ── Start Services ──────────────────────────────────────────────────────

  startPipelineWorker(client);
  startScoutService(client);
  startJobScheduler();
  client.login(process.env.DISCORD_TOKEN);
}
