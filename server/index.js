import { createServer } from "node:http";
import redis from "./redis.js";

const port = Number(process.env.PORT || 3001);
const REDIS_PING_TIMEOUT_MS = 2000;
const startedAt = Date.now();

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
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
  if (request.method !== "GET" || url.pathname !== "/api/health") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const uptimeSeconds = Math.round((Date.now() - startedAt) / 1000);
  try {
    await pingRedis();
    sendJson(response, 200, { status: "ok", redis: "connected", uptimeSeconds });
  } catch (error) {
    console.error("Redis health check failed:", error.message);
    sendJson(response, 503, { status: "degraded", redis: "unavailable", uptimeSeconds });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.info(`Health API listening on port ${port}`);
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
