import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ForumError } from "../forum/errors.js";
import { createLogger } from "../logger.js";
import type { AnyTool, PlayerToolContext, PublicToolContext } from "./define-tool.js";
import { playerTools, publicTools } from "./tools/index.js";

const logger = createLogger("mcp");

// Версия из package.json: dist/mcp/server.js → ../../package.json (и src/mcp/server.ts при tsx).
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
  version: string;
};

export const SERVER_INFO = { name: pkg.name, version: pkg.version } as const;

/**
 * Передаётся клиенту в initialize один раз (не в каждом описании инструмента).
 * Язык ответа пользователю не навязываем: модель и так отвечает на языке
 * собеседника. Важно другое — контент форума и то, что публикуется от имени
 * игрока, на русском.
 */
const SERVER_INSTRUCTIONS =
  "Minecraft Galaxy (MCGL) game forum. Forum content is in Russian. " +
  "Anything published to the forum on the user's behalf must be written in Russian unless the user explicitly asks otherwise.";

/**
 * Ошибка инструмента превращается в результат с isError, а не в ошибку
 * JSON-RPC, чтобы агент её увидел и мог отреагировать. Текст ForumError
 * отдаём как есть, остальное маскируем (там могут быть детали окружения).
 */
function toErrorResult(tool: string, error: unknown): CallToolResult {
  if (error instanceof ForumError) {
    logger.warn(`Tool ${tool} failed: ${error.message}`);
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
  logger.error(`Tool ${tool} crashed`, error);
  return { content: [{ type: "text", text: "Internal error while talking to the forum" }], isError: true };
}

/**
 * Собирает McpServer. Набор инструментов определяется контекстом:
 * без `session` регистрируются только публичные.
 */
export function createMcpServer(ctx: PublicToolContext | PlayerToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });
  const tools: AnyTool[] = "session" in ctx ? [...publicTools, ...playerTools] : [...publicTools];

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
        try {
          // Контекст подходит по построению: player-инструменты попадают сюда только с session.
          return await tool.handler(args as never, ctx as PlayerToolContext);
        } catch (error) {
          return toErrorResult(tool.name, error);
        }
      },
    );
  }

  return server;
}
