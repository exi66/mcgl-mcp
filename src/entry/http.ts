/**
 * Публичный режим: Streamable HTTP, stateless (сервер+транспорт на каждый запрос).
 * Только публичные инструменты, без авторизации. Креды из env здесь
 * намеренно не читаются.
 *
 * Позже сюда добавится второй эндпоинт `/mcp` с OAuth и инструментами игрока,
 * а этот переедет/останется как анонимный.
 */
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadForumEnv, loadHttpEnv } from "../env.js";
import { ForumHttp } from "../forum/http.js";
import { ForumReader } from "../forum/reader.js";
import { RateLimiter } from "../forum/rate-limiter.js";
import { createLogger } from "../logger.js";
import { createMcpServer, SERVER_INFO } from "../mcp/server.js";

const logger = createLogger("http");

const forumEnv = loadForumEnv();
const httpEnv = loadHttpEnv();

// Общий анонимный клиент и общий лимитер: все запросы к форуму идут с IP хоста.
const limiter = new RateLimiter(forumEnv.minIntervalMs);
const forumHttp = new ForumHttp(forumEnv, limiter);
const reader = new ForumReader(forumHttp);

const app = createMcpExpressApp({ host: httpEnv.host, allowedHosts: httpEnv.allowedHosts });

// Сам сервер жив (ok), форум — по данным circuit breaker (без лишних запросов к нему).
app.get("/health", (_req, res) => {
  res.json({ ok: true, ...SERVER_INFO, forum: forumHttp.health.status });
});

const MCP_PATH = "/public/mcp";

app.post(MCP_PATH, async (req: Request, res: Response) => {
  const server = createMcpServer({ reader });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error("Error handling MCP request", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// Stateless-режим: ни GET (SSE-стрим), ни DELETE (закрытие сессии) не нужны.
const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
app.get(MCP_PATH, methodNotAllowed);
app.delete(MCP_PATH, methodNotAllowed);

app.listen(httpEnv.port, httpEnv.host, () => {
  logger.info(`Listening on http://${httpEnv.host}:${httpEnv.port}${MCP_PATH} (forum: ${forumEnv.baseUrl})`);
});
