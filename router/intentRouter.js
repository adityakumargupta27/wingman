import { classifyUrl } from "./urlRouter.js";
import {
  getUserState,
  clearUserState
} from "./stateRouter.js";

export async function routeIntent(ctx) {
  const {
    text,
    userId,
    chatId,
    handlers
  } = ctx;

  const state = getUserState(userId);

  // 1. Handle Pending State (Priority)
  if (state.state === "tailor_mode") {
    clearUserState(userId);
    return handlers.handleTailor(chatId, userId, text, handlers);
  }

  if (state.state === "project_mode") {
    clearUserState(userId);
    return handlers.handleProject(chatId, text, handlers);
  }

  // 2. Auto-Detect URLs
  const urlMatch = text.match(/https?:\/\/\S+/);

  if (urlMatch) {
    const result = await classifyUrl(urlMatch[0]);

    switch (result.route) {
      case "project":
        return handlers.handleProject(chatId, result.url, handlers);

      case "evaluate":
        return handlers.handleEvaluate(chatId, userId, result.url, handlers);

      case "linkedin_profile":
        return handlers.handleConversational(
          chatId,
          userId,
          `Review this LinkedIn profile and suggest career improvements: ${result.url}`,
          handlers
        );

      case "portfolio":
        return handlers.handleConversational(
          chatId,
          userId,
          `Analyze this portfolio website for a technical role: ${result.url}`,
          handlers
        );

      case "youtube":
        return handlers.handleConversational(
          chatId,
          userId,
          `Summarize this video and extract career growth takeaways: ${result.url}`,
          handlers
        );

      case "blog":
        return handlers.handleConversational(
          chatId,
          userId,
          `Summarize this technical article and explain how it adds value to a resume: ${result.url}`,
          handlers
        );

      default:
        // Check if it's a generic job portal-like URL
        return handlers.handleEvaluate(chatId, userId, result.url, handlers);
    }
  }

  // 3. Fallback: Conversational AI
  return handlers.handleConversational(chatId, userId, text, handlers);
}
