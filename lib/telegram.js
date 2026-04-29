import TelegramBot from "node-telegram-bot-api";
import { routeCommand } from "../router/commandRouter.js";
import { routeIntent } from "../router/intentRouter.js";
import { checkRateLimit } from "../utils/rateLimiter.js";
import { safeSend } from "../utils/telegramUtils.js";
import log from "./logger.js";

/**
 * startTelegramBot — Main entry point for the Telegram Router.
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
        send: (cid, txt, opts) => safeSend(bot, cid, txt, opts),
        bot // Needed for getFileLink
      }
    };

    try {
      // 3. Handle Documents (PDFs)
      if (msg.document) {
        await bot.sendChatAction(chatId, "typing");
        return await ctx.handlers.handleDocument(chatId, userId, msg.document, ctx.handlers);
      }

      // Ignore messages without text (that aren't documents)
      if (!text) return;

      // Show typing indicator
      await bot.sendChatAction(chatId, "typing");

      // 4. Route: Command vs Intent
      if (text.startsWith("/")) {
        return await routeCommand(ctx);
      }

      return await routeIntent(ctx);

    } catch (err) {
      log.error('GLOBAL BOT ERROR', { error: err.message, stack: err.stack, userId, text });
      
      const debugMsg = `❌ *Runtime Error*\n\n` +
                       `📌 *Error:* ${err.message}\n\n` +
                       `📍 *Stack:* \`${err.stack?.split("\n").slice(0, 2).join("\n")}\``;
      
      await safeSend(bot, chatId, debugMsg, { parse_mode: 'Markdown' });
    }
  });

  bot.on('polling_error', (err) => {
    if (err.message.includes('409 Conflict')) return;
    log.error('Telegram Polling Error', { error: err.message });
  });

  log.info("Wingman Telegram Router Live 🛫");
}
