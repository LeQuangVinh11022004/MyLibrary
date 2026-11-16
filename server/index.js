import { createServer } from "node:http";
import os from "node:os";
import redis from "./redis.js";

const port = Number(process.env.PORT || 3001);
const instanceId = process.env.INSTANCE_ID || os.hostname();
const REDIS_PING_TIMEOUT_MS = 2000;
const LIBRARY_TTL_SECONDS = 300;
const PROGRESS_TTL_SECONDS = 60 * 60 * 24 * 30;
const PREFS_TTL_SECONDS = 60 * 60 * 24 * 90;
const MAX_BODY_BYTES = 512 * 1024;
const startedAt = Date.now();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidId(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-API-Instance": instanceId,
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

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  const { pathname, searchParams } = url;
  const method = request.method || "GET";

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

      if (method === "PUT") {
        const body = await readJsonBody(request);
        const payload = {
          documents: Array.isArray(body.documents) ? body.documents : [],
          folders: Array.isArray(body.folders) ? body.folders : [],
          cachedAt: Date.now(),
        };
        await redis.set(key, JSON.stringify(payload), "EX", LIBRARY_TTL_SECONDS);
        sendJson(response, 200, { stored: true, ttlSeconds: LIBRARY_TTL_SECONDS, instance: instanceId });
        return;
      }

      if (method === "DELETE") {
        await redis.del(key);
        sendJson(response, 200, { invalidated: true, instance: instanceId });
        return;
      }
    }

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
        sendJson(response, 200, { stored: true, instance: instanceId, progress: record });
        return;
      }
    }

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
        const body = await readJsonBody(request);
        const prefs = {
          theme: ["light", "sepia", "dark"].includes(body.theme) ? body.theme : "light",
          fontSize: Number.isFinite(Number(body.fontSize))
            ? Math.min(30, Math.max(14, Number(body.fontSize)))
            : 19,
          updatedAt: Date.now(),
        };
        await redis.set(key, JSON.stringify(prefs), "EX", PREFS_TTL_SECONDS);
        sendJson(response, 200, { stored: true, instance: instanceId, preferences: prefs });
        return;
      }
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
  console.info(`Redis Cache & Health API (${instanceId}) listening on port ${port}`);
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
