const REQUEST_TIMEOUT_MS = 1800;
const REDIS_API_ENABLED = import.meta.env.VITE_REDIS_API_ENABLED === "true";

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    window.clearTimeout(timer);
  }
}

async function apiRequest(path, options = {}) {
  if (!REDIS_API_ENABLED) {
    return { ok: false, status: 404, data: null };
  }
  return request(path, options);
}

export async function fetchApiHealth() {
  const { ok, data } = await apiRequest("/api/health", { method: "GET" });
  if (!data) return { status: "offline", redis: "unavailable", instance: null, cachedKeys: null };
  return {
    status: ok ? "ok" : "degraded",
    redis: data.redis || "unavailable",
    instance: data.instance || null,
    cachedKeys: Number.isFinite(data.cachedKeys) ? data.cachedKeys : null,
    uptimeSeconds: data.uptimeSeconds ?? null,
  };
}

export async function getCachedLibrarySnapshot(userId) {
  if (!userId) return null;
  const { ok, data } = await apiRequest(`/api/cache/library?userId=${encodeURIComponent(userId)}`);
  if (!ok || !data?.hit || !data.data) return null;
  return data.data;
}

export async function setCachedLibrarySnapshot(userId, snapshot) {
  if (!userId || !snapshot) return false;
  const { ok } = await apiRequest(`/api/cache/library?userId=${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify(snapshot),
  });
  return ok;
}

export async function invalidateCachedLibrarySnapshot(userId) {
  if (!userId) return false;
  const { ok } = await apiRequest(`/api/cache/library?userId=${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
  return ok;
}

export async function fetchRedisReadingProgress(userId, documentId) {
  if (!userId || !documentId) return null;
  const query = `userId=${encodeURIComponent(userId)}&documentId=${encodeURIComponent(documentId)}`;
  const { ok, data } = await apiRequest(`/api/progress?${query}`);
  if (!ok || !data?.hit) return null;
  return data.progress || null;
}

export async function saveRedisReadingProgress(userId, documentId, progress) {
  if (!userId || !documentId || !progress) return false;
  const query = `userId=${encodeURIComponent(userId)}&documentId=${encodeURIComponent(documentId)}`;
  const { ok } = await apiRequest(`/api/progress?${query}`, {
    method: "PUT",
    body: JSON.stringify({ progress }),
  });
  return ok;
}

export async function fetchRedisReaderPreferences(userId) {
  if (!userId) return null;
  const { ok, data } = await apiRequest(`/api/preferences?userId=${encodeURIComponent(userId)}`);
  if (!ok || !data?.hit) return null;
  return data.preferences || null;
}

export async function saveRedisReaderPreferences(userId, preferences) {
  if (!userId || !preferences) return false;
  const { ok } = await apiRequest(`/api/preferences?userId=${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify(preferences),
  });
  return ok;
}
