const SESSION_SEGMENT = "session";

export function sessionCacheKey(baseKey, userId) {
  const base = String(baseKey || "").trim();
  const owner = String(userId || "").trim();
  if (!base || !owner) return null;
  return `${base}:${SESSION_SEGMENT}:${owner}`;
}

function browserSessionStorage() {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage;
}

// Operational data may contain customer information, so it is kept only for
// the lifetime of the authenticated browser tab. There is no persistent fallback.
export const sessionCacheStorage = {
  async get(key) {
    if (!key) return null;
    const value = browserSessionStorage()?.getItem(key) ?? null;
    return value ? { value } : null;
  },
  async set(key, value) {
    if (!key) return false;
    const target = browserSessionStorage();
    if (!target) return false;
    target.setItem(key, value);
    return true;
  },
  async delete(key) {
    if (!key) return true;
    browserSessionStorage()?.removeItem(key);
    return true;
  },
};

export function legacyCacheKeys(baseKey, userId) {
  const base = String(baseKey || "").trim();
  const owner = String(userId || "").trim();
  if (!base) return [];
  return owner ? [base, `${base}:${owner}`] : [base];
}
