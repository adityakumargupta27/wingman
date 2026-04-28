import {
  setUserState,
  clearUserState
} from "./stateRouter.js";

export async function routeCommand(ctx) {
  const { text, userId, chatId, handlers } = ctx;

  const [cmd, ...rest] = text.split(" ");
  const arg = rest.join(" ").trim();

  switch (cmd.toLowerCase()) {
    case "/start":
    case "/help":
      return handlers.handleHelp(chatId);

    case "/project":
    case "/proj":
      if (!arg) {
        setUserState(userId, "project_mode");
        return handlers.send(chatId, "📎 OK, send me the **GitHub URL** or **Project Description** you want to analyze.", { parse_mode: 'Markdown' });
      }
      return handlers.handleProject(chatId, arg);

    case "/deep":
    case "/research":
      if (!arg) {
        return handlers.send(chatId, "🕵️ Usage: `/deep Company Name`", { parse_mode: 'Markdown' });
      }
      return handlers.handleDeep(chatId, arg);

    case "/tailor":
      if (!arg) {
        setUserState(userId, "tailor_mode");
        return handlers.send(chatId, "✂️ OK, send me the **Job URL** or **JD Text** you want to tailor your resume for.", { parse_mode: 'Markdown' });
      }
      return handlers.handleTailor(chatId, userId, arg);

    case "/jobs":
      return handlers.handleJobs(chatId, userId, arg);

    case "/tracker":
      return handlers.handleTracker(chatId, userId);

    case "/evaluate":
    case "/eval":
      if (!arg) {
        return handlers.send(chatId, "🎯 Usage: `/evaluate Job URL`", { parse_mode: 'Markdown' });
      }
      return handlers.handleEvaluate(chatId, userId, arg);

    case "/cancel":
      clearUserState(userId);
      return handlers.send(chatId, "✅ Action cancelled.");

    default:
      return handlers.send(chatId, "⚠️ Unknown command. Use /help to see available features.");
  }
}
