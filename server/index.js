import { createServer } from "node:http";
import redis from "./redis.js";

const port = Number(process.env.PORT || 3001);

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (request.method !== "GET" || url.pathname !== "/api/health") {
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    await redis.ping();
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ status: "ok", redis: "connected" }));
  } catch (error) {
    console.error("Redis health check failed:", error.message);
    response.writeHead(503, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ status: "degraded", redis: "unavailable" }));
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
