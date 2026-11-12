#!/usr/bin/env node
/**
 * Локальный режим: MCP-клиент запускает процесс и общается через stdin/stdout.
 * Креды игрока берутся из env (FORUM_LOGIN / FORUM_PASSWORD), которые пользователь
 * сам прописывает в конфиге клиента. Без них доступны только публичные инструменты.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadForumEnv, loadPlayerCredentials } from "../env.js";
import { ForumHttp } from "../forum/http.js";
import { PlayerSession } from "../forum/player-session.js";
import { ForumReader } from "../forum/reader.js";
import { RateLimiter } from "../forum/rate-limiter.js";
import { createLogger } from "../logger.js";
import { createMcpServer } from "../mcp/server.js";

const logger = createLogger("stdio");

async function main(): Promise<void> {
  const forumEnv = loadForumEnv();
  const credentials = loadPlayerCredentials();
  const http = new ForumHttp(forumEnv, new RateLimiter(forumEnv.minIntervalMs));

  if (!credentials) {
    await createMcpServer({ reader: new ForumReader(http) }).connect(new StdioServerTransport());
    logger.info("Started with public tools only (FORUM_LOGIN/FORUM_PASSWORD not set)");
    return;
  }

  const session = new PlayerSession(http, credentials);
  await createMcpServer({ reader: new ForumReader(http, session), session }).connect(new StdioServerTransport());
  logger.info(`Started with player tools for login "${credentials.login}"`);

  // Логинимся сразу, чтобы неверный пароль был виден в логах клиента при старте,
  // а не при первом вызове инструмента. Процесс не падает: ошибку получит и инструмент.
  session.whoami().then(
    (username) => logger.info(`Authorized as ${username}`),
    (error: unknown) => logger.error(`Authorization failed: ${error instanceof Error ? error.message : String(error)}`),
  );
}

main().catch((error) => {
  logger.error("Fatal", error);
  process.exit(1);
});
