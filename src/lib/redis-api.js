import {
  getDeviceId,
  getDeviceLabel,
  getSecurityHeaders,
  solvePowChallenge,
} from "./security-shield";

const REQUEST_TIMEOUT_MS = 2000;
const REDIS_API_ENABLED = import.meta.env.VITE_REDIS_API_ENABLED !== "false";

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const securityHeaders = getSecurityHeaders();
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...securityHeaders,
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
    maxSessions: data.maxSessions ?? 3,
    powDifficulty: data.powDifficulty ?? 3,
    limits: data.limits || null,
    uptimeSeconds: data.uptimeSeconds ?? null,
  };
}

export async function verifyAuthRateLimit({ mode, honeypot = "" } = {}) {
  let pow = null;
  const challengeRes = await apiRequest("/api/auth/challenge", { method: "GET" });
  if (challengeRes.status === 429) {
    throw new Error(challengeRes.data?.error || "Yêu cầu mã xác thực quá thường xuyên. Vui lòng thử lại sau.");
  }
  if (challengeRes.ok && challengeRes.data?.nonce) {
    pow = await solvePowChallenge(challengeRes.data.nonce, challengeRes.data.difficulty);
  }
  const { ok, status, data } = await apiRequest("/api/auth/guard", {
    method: "POST",
    body: JSON.stringify({ mode, honeypot, pow }),
  });
  if (status === 429) {
    throw new Error(data?.error || `Bạn đã thử quá nhiều lần. Vui lòng đợi ${data?.retryAfter || 60} giây.`);
  }
  if (status === 403 || status === 401) {
    throw new Error(data?.error || "Yêu cầu bị từ chối bởi bộ lọc chống spam/bot.");
  }
  return ok ? data : { allowed: true };
}

export async function registerActiveSession(userId) {
  if (!userId) return null;
  const { ok, data } = await apiRequest(`/api/sessions?userId=${encodeURIComponent(userId)}`, {
    method: "POST",
    body: JSON.stringify({
      deviceId: getDeviceId(),
      label: getDeviceLabel(),
    }),
  });
  return ok ? data : null;
}

export async function fetchActiveSessions(userId) {
  if (!userId) return null;
  const query = `userId=${encodeURIComponent(userId)}&deviceId=${encodeURIComponent(getDeviceId())}`;
  const { ok, data } = await apiRequest(`/api/sessions?${query}`, { method: "GET" });
  return ok ? data : null;
}

export async function revokeUserSession(userId, { keepCurrent = false, deviceId = getDeviceId() } = {}) {
  if (!userId) return null;
  const query = new URLSearchParams({
    userId,
    deviceId,
    ...(keepCurrent ? { keepCurrent: "true" } : {}),
  });
  const { ok, data } = await apiRequest(`/api/sessions?${query.toString()}`, {
    method: "DELETE",
  });
  return ok ? data : null;
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
