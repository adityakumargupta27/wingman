const users = new Map();

export function checkRateLimit(userId) {
  const now = Date.now();

  if (!users.has(userId)) {
    users.set(userId, { last: now, strikes: 0 });
    return { allowed: true };
  }

  const user = users.get(userId);
  const diff = now - user.last;

  if (diff < 1000) {
    user.strikes += 1;
    user.last = now;

    if (user.strikes >= 5) {
      return {
        allowed: false,
        message: "⛔ Slow down. Wait 10 seconds."
      };
    }

    return {
      allowed: false,
      message: "⚠️ Please wait a moment."
    };
  }

  user.last = now;
  user.strikes = 0;

  return { allowed: true };
}
