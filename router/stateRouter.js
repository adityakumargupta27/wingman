const stateMap = new Map();

const TTL_MS = 10 * 60 * 1000;

export function setUserState(userId, state, data = {}) {
  stateMap.set(userId, {
    state,
    data,
    expiresAt: Date.now() + TTL_MS
  });
}

export function getUserState(userId) {
  const item = stateMap.get(userId);
  if (!item) return { state: "idle", data: {} };

  if (Date.now() > item.expiresAt) {
    stateMap.delete(userId);
    return { state: "idle", data: {} };
  }

  return item;
}

export function clearUserState(userId) {
  stateMap.delete(userId);
}
