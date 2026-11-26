import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import redis from "./redis.js";

const port = Number(process.env.PORT || 3001);
const instanceId = process.env.INSTANCE_ID || os.hostname();
const REDIS_PING_TIMEOUT_MS = 2000;
const LIBRARY_TTL_SECONDS = 300;
const PROGRESS_TTL_SECONDS = 60 * 60 * 24 * 30;
const PREFS_TTL_SECONDS = 60 * 60 * 24 * 90;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const CHALLENGE_TTL_SECONDS = 120;
const POW_DIFFICULTY = Math.min(5, Math.max(2, Number(process.env.POW_DIFFICULTY || 3)));
const MAX_ACTIVE_SESSIONS = Math.max(1, Number(process.env.MAX_ACTIVE_SESSIONS || 3));

// Configurable Rate Limit Thresholds
const API_RATE_LIMIT_PER_MIN = Math.max(20, Number(process.env.API_RATE_LIMIT_PER_MIN || 120));
const AUTH_RATE_LIMIT_5MIN = Math.max(3, Number(process.env.AUTH_RATE_LIMIT_5MIN || 8));
const CHALLENGE_RATE_LIMIT_PER_MIN = Math.max(5, Number(process.env.CHALLENGE_RATE_LIMIT_PER_MIN || 20));
const SESSIONS_RATE_LIMIT_PER_MIN = Math.max(5, Number(process.env.SESSIONS_RATE_LIMIT_PER_MIN || 30));
const CACHE_MUTATE_RATE_LIMIT_PER_MIN = Math.max(5, Number(process.env.CACHE_MUTATE_RATE_LIMIT_PER_MIN || 40));
const PROGRESS_RATE_LIMIT_PER_MIN = Math.max(10, Number(process.env.PROGRESS_RATE_LIMIT_PER_MIN || 60));
const PREFS_RATE_LIMIT_PER_MIN = Math.max(5, Number(process.env.PREFS_RATE_LIMIT_PER_MIN || 30));

const MAX_BODY_BYTES = 512 * 1024;
const startedAt = Date.now();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT_UA_RE = /\b(bot|crawler|spider|scrapy|curl|wget|python-requests|httpx|aiohttp|go-http-client|java\/|libwww-perl|headlesschrome|phantomjs|slimerjs|gptbot|chatgpt-user|ccbot|claudebot|anthropic-ai|bytespider|amazonbot|facebookexternalhit|semrushbot|ahrefsbot|mj12bot|dotbot)\b/i;

function isValidId(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function getClientIp(request) {
  const cfIp = request.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) return cfIp.trim();
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  return request.socket?.remoteAddress || "unknown";
}

function isAutomatedCrawler(request) {
  const ua = String(request.headers["user-agent"] || "").trim();
  if (!ua || ua.length < 8) return true;
  return BOT_UA_RE.test(ua);
}

function sendJson(response, statusCode, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-API-Instance": instanceId,
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let bytes = 0;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error("Payload too large"));
        request.destroy();
        return;
      }
      raw += chunk;
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function pingRedis() {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Redis ping timed out")), REDIS_PING_TIMEOUT_MS);
  });
  return Promise.race([redis.ping(), timeout]).finally(() => clearTimeout(timer));
}

async function consumeRateLimit(bucket, identifier, maxHits, windowSeconds) {
  const key = `trang-sach:rl:${bucket}:${identifier}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    } else {
      const ttl = await redis.ttl(key);
      if (ttl === -1) {
        await redis.expire(key, windowSeconds);
      }
    }
    const currentTtl = await redis.ttl(key);
    const retryAfter = Math.max(1, currentTtl > 0 ? currentTtl : windowSeconds);
    return {
      allowed: count <= maxHits,
      count,
      limit: maxHits,
      remaining: Math.max(0, maxHits - count),
      retryAfter,
      reset: Math.ceil(Date.now() / 1000) + retryAfter,
    };
  } catch {
    return {
      allowed: true,
      count: 1,
      limit: maxHits,
      remaining: maxHits,
      retryAfter: 0,
      reset: Math.ceil(Date.now() / 1000) + windowSeconds,
    };
  }
}

async function enforceRateLimit(response, bucket, identifier, maxHits, windowSeconds, customMessage) {
  const result = await consumeRateLimit(bucket, identifier, maxHits, windowSeconds);
  const headers = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.reset),
  };
  if (!result.allowed) {
    headers["Retry-After"] = String(result.retryAfter);
    sendJson(
      response,
      429,
      {
        error: customMessage || `Quá nhiều yêu cầu. Vui lòng thử lại sau ${result.retryAfter} giây.`,
        retryAfter: result.retryAfter,
        limit: result.limit,
      },
      headers,
    );
    return null;
  }
  return headers;
}

async function loadUserSessions(userId) {
  const key = `trang-sach:sessions:${userId.toLowerCase()}`;
  const raw = await redis.get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((entry) => entry && entry.deviceId && (now - (entry.lastSeenAt || 0)) < SESSION_TTL_SECONDS * 1000);
  } catch {
    return [];
  }
}

async function saveUserSessions(userId, sessions) {
  const key = `trang-sach:sessions:${userId.toLowerCase()}`;
  await redis.set(key, JSON.stringify(sessions), "EX", SESSION_TTL_SECONDS);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  const { pathname, searchParams } = url;
  const method = request.method || "GET";
  const clientIp = getClientIp(request);

  try {
    if (method === "GET" && pathname === "/api/health") {
      const uptimeSeconds = Math.round((Date.now() - startedAt) / 1000);
      try {
        await pingRedis();
        const cachedKeys = await redis.dbsize().catch(() => null);
        sendJson(response, 200, {
          status: "ok",
          redis: "connected",
          instance: instanceId,
          cachedKeys,
          maxSessions: MAX_ACTIVE_SESSIONS,
          powDifficulty: POW_DIFFICULTY,
          limits: {
            apiPerMin: API_RATE_LIMIT_PER_MIN,
            auth5Min: AUTH_RATE_LIMIT_5MIN,
            challengePerMin: CHALLENGE_RATE_LIMIT_PER_MIN,
            sessionsPerMin: SESSIONS_RATE_LIMIT_PER_MIN,
            progressPerMin: PROGRESS_RATE_LIMIT_PER_MIN,
            cacheMutatePerMin: CACHE_MUTATE_RATE_LIMIT_PER_MIN,
          },
          uptimeSeconds,
        });
      } catch (error) {
        console.error("Redis health check failed:", error.message);
        sendJson(response, 503, {
          status: "degraded",
          redis: "unavailable",
          instance: instanceId,
          uptimeSeconds,
        });
      }
      return;
    }

    if (isAutomatedCrawler(request)) {
      sendJson(response, 403, {
        error: "Truy cập tự động hoặc bot thu thập dữ liệu đã bị chặn.",
        code: "BOT_CRAWLER_BLOCKED",
      });
      return;
    }

    // 1. General API Rate Limit per IP (120 req/min)
    const generalHeaders = await enforceRateLimit(
      response,
      "api",
      clientIp,
      API_RATE_LIMIT_PER_MIN,
      60,
      `Quá nhiều yêu cầu từ địa chỉ này. Vui lòng thử lại sau ít phút.`,
    );
    if (!generalHeaders) return;

    // 2. PoW Challenge Rate Limit (20 req/min per IP) - Prevents challenge generation spam
    if (pathname === "/api/auth/challenge" && method === "GET") {
      const challengeHeaders = await enforceRateLimit(
        response,
        "challenge",
        clientIp,
        CHALLENGE_RATE_LIMIT_PER_MIN,
        60,
        `Yêu cầu mã xác thực chống bot quá thường xuyên. Vui lòng thử lại sau ít phút.`,
      );
      if (!challengeHeaders) return;

      const nonce = randomBytes(16).toString("hex");
      const challengeKey = `trang-sach:pow:${nonce}`;
      await redis.set(challengeKey, JSON.stringify({ ip: clientIp, difficulty: POW_DIFFICULTY }), "EX", CHALLENGE_TTL_SECONDS);
      sendJson(response, 200, {
        nonce,
        difficulty: POW_DIFFICULTY,
        expiresIn: CHALLENGE_TTL_SECONDS,
        instance: instanceId,
      }, challengeHeaders);
      return;
    }

    // 3. Auth Guard Rate Limit (8 attempts / 5 mins per IP) + Honeypot Detection
    if (pathname === "/api/auth/guard" && method === "POST") {
      const body = await readJsonBody(request);
      if (body.honeypot && String(body.honeypot).trim() !== "") {
        await consumeRateLimit("auth", clientIp, 1, 900);
        sendJson(response, 403, {
          error: "Phát hiện hành vi spam tự động.",
          code: "BOT_HONEYPOT_TRIGGERED",
        });
        return;
      }
      const authHeaders = await enforceRateLimit(
        response,
        "auth",
        clientIp,
        AUTH_RATE_LIMIT_5MIN,
        300,
        `Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi ít phút để bảo vệ tài khoản.`,
      );
      if (!authHeaders) return;

      if (body.pow && typeof body.pow === "object") {
        const { nonce, counter } = body.pow;
        if (!nonce || !Number.isInteger(counter) || counter < 0) {
          sendJson(response, 403, { error: "Bằng chứng chống bot (Proof-of-Work) không hợp lệ." }, authHeaders);
          return;
        }
        const challengeKey = `trang-sach:pow:${nonce}`;
        const rawChallenge = await redis.get(challengeKey);
        await redis.del(challengeKey);
        if (!rawChallenge) {
          sendJson(response, 403, { error: "Phiên xác thực chống bot đã hết hạn. Vui lòng thử lại." }, authHeaders);
          return;
        }
        const challenge = JSON.parse(rawChallenge);
        const targetPrefix = "0".repeat(challenge.difficulty || POW_DIFFICULTY);
        const digest = createHash("sha256").update(`${nonce}:${counter}`).digest("hex");
        if (!digest.startsWith(targetPrefix)) {
          sendJson(response, 403, { error: "Xác thực Proof-of-Work không khớp." }, authHeaders);
          return;
        }
      }

      sendJson(response, 200, {
        allowed: true,
        remainingAttempts: Number(authHeaders["X-RateLimit-Remaining"]),
        instance: instanceId,
      }, authHeaders);
      return;
    }

    // 4. Session Management (GET: unlimited within general limit, POST/DELETE: strictly rate-limited)
    if (pathname === "/api/sessions") {
      const userId = searchParams.get("userId") || "";
      if (!isValidId(userId)) {
        sendJson(response, 400, { error: "Invalid userId" });
        return;
      }
      const headerDeviceId = String(request.headers["x-client-device-id"] || searchParams.get("deviceId") || "").trim();
      const deviceLabel = String(request.headers["x-client-device-label"] || "Trình duyệt Web").slice(0, 64);

      if (method === "GET") {
        const sessions = await loadUserSessions(userId);
        const currentActive = !headerDeviceId || sessions.length === 0
          ? true
          : sessions.some((session) => session.deviceId === headerDeviceId);
        sendJson(response, 200, {
          sessions,
          maxSessions: MAX_ACTIVE_SESSIONS,
          currentActive,
          instance: instanceId,
        });
        return;
      }

      if (method === "POST") {
        const sessionRateHeaders = await enforceRateLimit(
          response,
          "sessions_post",
          `${clientIp}:${userId.toLowerCase()}`,
          SESSIONS_RATE_LIMIT_PER_MIN,
          60,
          "Đăng ký phiên thiết bị quá nhanh. Vui lòng thử lại sau.",
        );
        if (!sessionRateHeaders) return;

        const body = await readJsonBody(request);
        const deviceId = String(body.deviceId || headerDeviceId || "").trim();
        if (!deviceId) {
          sendJson(response, 400, { error: "Missing deviceId" });
          return;
        }
        const now = Date.now();
        let sessions = await loadUserSessions(userId);
        const existingIndex = sessions.findIndex((session) => session.deviceId === deviceId);
        const record = {
          deviceId,
          label: String(body.label || deviceLabel).slice(0, 64),
          ipHint: clientIp.replace(/(\.\d+$|:[^:]+$)/, ".***"),
          createdAt: existingIndex >= 0 ? sessions[existingIndex].createdAt : now,
          lastSeenAt: now,
        };
        if (existingIndex >= 0) {
          sessions[existingIndex] = record;
        } else {
          sessions.push(record);
        }
        sessions.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
        const evictedCount = Math.max(0, sessions.length - MAX_ACTIVE_SESSIONS);
        sessions = sessions.slice(0, MAX_ACTIVE_SESSIONS);
        await saveUserSessions(userId, sessions);
        sendJson(response, 200, {
          active: true,
          evictedCount,
          sessions,
          maxSessions: MAX_ACTIVE_SESSIONS,
          instance: instanceId,
        }, sessionRateHeaders);
        return;
      }

      if (method === "DELETE") {
        const revokeRateHeaders = await enforceRateLimit(
          response,
          "sessions_del",
          `${clientIp}:${userId.toLowerCase()}`,
          15,
          60,
          "Thao tác thu hồi phiên quá thường xuyên.",
        );
        if (!revokeRateHeaders) return;

        const keepCurrent = searchParams.get("keepCurrent") === "true";
        const targetDeviceId = searchParams.get("deviceId") || headerDeviceId;
        let sessions = await loadUserSessions(userId);
        if (keepCurrent && targetDeviceId) {
          sessions = sessions.filter((session) => session.deviceId === targetDeviceId);
        } else if (targetDeviceId) {
          sessions = sessions.filter((session) => session.deviceId !== targetDeviceId);
        } else {
          sessions = [];
        }
        await saveUserSessions(userId, sessions);
        sendJson(response, 200, {
          sessions,
          maxSessions: MAX_ACTIVE_SESSIONS,
          instance: instanceId,
        }, revokeRateHeaders);
        return;
      }
    }

    // 5. Library Cache (GET: general rate limit; PUT/DELETE: 40/min to avoid cache thrashing)
    if (pathname === "/api/cache/library") {
      const userId = searchParams.get("userId") || "";
      if (!isValidId(userId)) {
        sendJson(response, 400, { error: "Invalid userId" });
        return;
      }
      const key = `trang-sach:lib:${userId.toLowerCase()}`;

      if (method === "GET") {
        const raw = await redis.get(key);
        if (!raw) {
          sendJson(response, 200, { hit: false, instance: instanceId });
          return;
        }
        sendJson(response, 200, { hit: true, instance: instanceId, data: JSON.parse(raw) });
        return;
      }

      if (method === "PUT" || method === "DELETE") {
        const mutateHeaders = await enforceRateLimit(
          response,
          "cache_mutate",
          `${clientIp}:${userId.toLowerCase()}`,
          CACHE_MUTATE_RATE_LIMIT_PER_MIN,
          60,
          "Thao tác cập nhật bộ nhớ đệm thư viện quá thường xuyên.",
        );
        if (!mutateHeaders) return;

        if (method === "PUT") {
          const body = await readJsonBody(request);
          const payload = {
            documents: Array.isArray(body.documents) ? body.documents : [],
            folders: Array.isArray(body.folders) ? body.folders : [],
            cachedAt: Date.now(),
          };
          await redis.set(key, JSON.stringify(payload), "EX", LIBRARY_TTL_SECONDS);
          sendJson(response, 200, { stored: true, ttlSeconds: LIBRARY_TTL_SECONDS, instance: instanceId }, mutateHeaders);
          return;
        }

        if (method === "DELETE") {
          await redis.del(key);
          sendJson(response, 200, { invalidated: true, instance: instanceId }, mutateHeaders);
          return;
        }
      }
    }

    // 6. Reading Progress (GET: general limit; PUT: 60/min per user to prevent scroll spam)
    if (pathname === "/api/progress") {
      const userId = searchParams.get("userId") || "";
      const documentId = searchParams.get("documentId") || "";
      if (!isValidId(userId) || !isValidId(documentId)) {
        sendJson(response, 400, { error: "Invalid userId or documentId" });
        return;
      }
      const key = `trang-sach:prog:${userId.toLowerCase()}:${documentId.toLowerCase()}`;
      const recentKey = `trang-sach:recent:${userId.toLowerCase()}`;

      if (method === "GET") {
        const raw = await redis.get(key);
        sendJson(response, 200, {
          hit: Boolean(raw),
          instance: instanceId,
          progress: raw ? JSON.parse(raw) : null,
        });
        return;
      }

      if (method === "PUT") {
        const progressHeaders = await enforceRateLimit(
          response,
          "progress_put",
          `${clientIp}:${userId.toLowerCase()}`,
          PROGRESS_RATE_LIMIT_PER_MIN,
          60,
          "Đồng bộ tiến độ đọc quá nhanh.",
        );
        if (!progressHeaders) return;

        const body = await readJsonBody(request);
        if (!body?.progress || typeof body.progress !== "object") {
          sendJson(response, 400, { error: "Missing progress object" });
          return;
        }
        const record = { ...body.progress, updatedAt: body.progress.updatedAt || Date.now() };
        await Promise.all([
          redis.set(key, JSON.stringify(record), "EX", PROGRESS_TTL_SECONDS),
          redis.zadd(recentKey, record.updatedAt, documentId.toLowerCase()),
          redis.expire(recentKey, PROGRESS_TTL_SECONDS),
        ]);
        sendJson(response, 200, { stored: true, instance: instanceId, progress: record }, progressHeaders);
        return;
      }
    }

    // 7. Preferences (GET: general limit; PUT: 30/min per user)
    if (pathname === "/api/preferences") {
      const userId = searchParams.get("userId") || "";
      if (!isValidId(userId)) {
        sendJson(response, 400, { error: "Invalid userId" });
        return;
      }
      const key = `trang-sach:prefs:${userId.toLowerCase()}`;

      if (method === "GET") {
        const raw = await redis.get(key);
        sendJson(response, 200, {
          hit: Boolean(raw),
          instance: instanceId,
          preferences: raw ? JSON.parse(raw) : null,
        });
        return;
      }

      if (method === "PUT") {
        const prefsHeaders = await enforceRateLimit(
          response,
          "prefs_put",
          `${clientIp}:${userId.toLowerCase()}`,
          PREFS_RATE_LIMIT_PER_MIN,
          60,
          "Lưu tùy chỉnh giao diện quá nhanh.",
        );
        if (!prefsHeaders) return;

        const body = await readJsonBody(request);
        const prefs = {
          theme: ["light", "sepia", "dark"].includes(body.theme) ? body.theme : "light",
          fontSize: Number.isFinite(Number(body.fontSize))
            ? Math.min(30, Math.max(14, Number(body.fontSize)))
            : 19,
          updatedAt: Date.now(),
        };
        await redis.set(key, JSON.stringify(prefs), "EX", PREFS_TTL_SECONDS);
        sendJson(response, 200, { stored: true, instance: instanceId, preferences: prefs }, prefsHeaders);
        return;
      }
    }

    // 8. Translation Proxy (EN <-> VI) with Redis Cache (7 days) & Rate Limit (40/min)
    if (pathname === "/api/translate" && method === "POST") {
      const translateHeaders = await enforceRateLimit(
        response,
        "translate",
        clientIp,
        40,
        60,
        "Bạn dịch quá nhanh. Vui lòng đợi một lát rồi thử lại.",
      );
      if (!translateHeaders) return;

      const body = await readJsonBody(request);
      const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 480);
      const source = body.source === "vi" ? "vi" : "en";
      const target = body.target === "en" ? "en" : "vi";
      if (!text || source === target) {
        sendJson(response, 400, { error: "Đoạn văn bản hoặc ngôn ngữ dịch không hợp lệ." }, translateHeaders);
        return;
      }

      const hash = createHash("sha256").update(`${source}|${target}|${text}`).digest("hex").slice(0, 32);
      const cacheKey = `trang-sach:tr:${source}:${target}:${hash}`;
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) {
        sendJson(response, 200, { translation: cached, cached: true, instance: instanceId }, translateHeaders);
        return;
      }

      const upstream = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`,
      );
      if (!upstream.ok) {
        sendJson(response, 502, { error: "Dịch vụ dịch đang bận." }, translateHeaders);
        return;
      }
      const data = await upstream.json();
      const translation = data?.responseData?.translatedText;
      if (!translation || Number(data?.responseStatus) !== 200) {
        sendJson(response, 502, { error: "Không dịch được đoạn văn này." }, translateHeaders);
        return;
      }
      await redis.set(cacheKey, translation, "EX", 60 * 60 * 24 * 7).catch(() => {});
      sendJson(response, 200, { translation, cached: false, instance: instanceId }, translateHeaders);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.warn(`API error (${method} ${pathname}):`, error.message);
    sendJson(response, 503, {
      error: error.message || "Redis service unavailable",
      redis: "unavailable",
      instance: instanceId,
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.info(`Redis Cache & Security API (${instanceId}) listening on port ${port}`);
});

async function shutdown() {
  server.close();
  try {
    await redis.quit();
  } catch (error) {
    console.warn("Redis closed without a graceful quit:", error.message);
    redis.disconnect();
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
