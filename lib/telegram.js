import TelegramBot from "node-telegram-bot-api";
import { routeCommand } from "../router/commandRouter.js";
import { routeIntent } from "../router/intentRouter.js";
import { checkRateLimit } from "../utils/rateLimiter.js";
import { safeSend } from "../utils/telegramUtils.js";
import log from "./logger.js";

/**
 * startTelegramBot — Main entry point for the Telegram Router.
 * This architecture separates Command logic, URL logic, and State logic.
 * 
 * @param {object} handlers - The career agent handlers (handleProject, handleEvaluate, etc.)
 */
export function startTelegramBot(handlers) {
  if (!process.env.TELEGRAM_TOKEN) {
    log.error("TELEGRAM_TOKEN missing from environment. Telegram bot disabled.");
    return;
  }

  const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
    polling: true
  });

  bot.on("message", async msg => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const text = (msg.text || "").trim();

    if (!text) return;

    // 1. Anti-Spam Check
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      return safeSend(bot, chatId, rate.message);
    }

    // 2. Prepare Context for Routers
    const ctx = {
      bot,
      text,
      chatId,
      userId,
      handlers: {
        ...handlers,
        // Wrap the generic handlers with a formatted sender
        send: (cid, txt, opts) => safeSend(bot, cid, txt, opts)
      }
    };

    try {
      // Show typing indicator to user
      await bot.sendChatAction(chatId, "typing");

      // 3. Route: Command vs Intent
      if (text.startsWith("/")) {
        return await routeCommand(ctx);
      }

      return await routeIntent(ctx);

    } catch (err) {
      log.error('Telegram Router Crash', { error: err.message, userId, text });
      await safeSend(bot, chatId, "❌ Wingman encountered an error processing your request. Please try again or use /cancel.");
    }
  });

  bot.on('polling_error', (err) => {
    if (err.message.includes('409 Conflict')) {
        // Expected when multiple instances run (local vs cloud)
        return;
    }
    log.error('Telegram Polling Error', { error: err.message });
  });

  log.info("Wingman Telegram Router Live 🛫");
}
