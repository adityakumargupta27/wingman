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

    // 0. Global Pause Check
    const isPaused = true; // Set to true to pause the bot
    if (isPaused) {
      return safeSend(bot, chatId, "⛔ *Access Denied*\n\nPlease get permission from *Aditya Kumar Gupta* to use this bot.", { parse_mode: 'Markdown' });
    }

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

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id.toString();
    const data = query.data;
    
    // Global Pause Check
    const isPaused = true; 
    if (isPaused) {
      return safeSend(bot, chatId, "⛔ *Access Denied*\n\nPlease get permission from *Aditya Kumar Gupta* to use this bot.", { parse_mode: 'Markdown' });
    }
    
    try {
      if (data.startsWith('jobs_loc_')) {
        const loc = data.replace('jobs_loc_', '');
        await bot.answerCallbackQuery(query.id);
        
        // Setup context similar to message
        const ctx = {
          bot,
          text: `/jobs ${loc}`,
          chatId,
          userId,
          handlers: {
            ...handlers,
            send: (cid, txt, opts) => safeSend(bot, cid, txt, opts),
            bot
          }
        };
        
        // Route it as a command
        await routeCommand(ctx);
      } else if (data.startsWith('tailor_format:')) {
        const payload = data.replace('tailor_format:', '');
        const [format, jd] = payload.split('|jd:');
        
        await bot.answerCallbackQuery(query.id, { text: `Choice recorded: ${format.toUpperCase()}` });
        
        const h = {
          ...handlers,
          send: (cid, txt, opts) => safeSend(bot, cid, txt, opts),
          bot
        };
        
        // Call handleTailor with the special format string
        await handlers.handleTailor(chatId, userId, `format:${format}|jd:${jd}`, h);
      } else {
        await bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
      }
    } catch (err) {
      log.error('CALLBACK ERROR', { error: err.message, data });
    }
  });

  bot.on('polling_error', (err) => {
    if (err.message.includes('409 Conflict')) return;
    log.error('Telegram Polling Error', { error: err.message });
  });

  log.info("Wingman Telegram Router Live 🛫");
}
