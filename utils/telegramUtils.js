export async function safeSend(bot, chatId, text, opts = {}) {
  const chunks = chunkText(text, 3900);

  for (const part of chunks) {
    try {
      await bot.sendMessage(chatId, part, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        ...opts
      });
    } catch (err) {
      // Fallback if Markdown fails due to special characters
      await bot.sendMessage(chatId, part, {
        disable_web_page_preview: true,
        ...opts
      });
    }
  }
}

function chunkText(text, size) {
  if (!text) return [""];
  const out = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}
