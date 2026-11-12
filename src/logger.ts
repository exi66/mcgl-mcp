/**
 * Минимальный логгер. Пишет ТОЛЬКО в stderr: в stdio-режиме stdout занят
 * протоколом MCP, и любая строка туда ломает клиента.
 *
 * Никогда не передавай сюда пароли, куки и заголовки запросов целиком.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const minLevel: number = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

function serialize(meta: unknown): string {
  if (meta === undefined) return "";
  if (meta instanceof Error) return ` ${meta.stack ?? meta.message}`;
  try {
    return ` ${JSON.stringify(meta, (_k, v) => (v instanceof Error ? v.message : v))}`;
  } catch {
    return ` ${String(meta)}`;
  }
}

export function createLogger(context: string): Logger {
  const log = (level: Level) => (msg: string, meta?: unknown) => {
    if (LEVELS[level] < minLevel) return;
    process.stderr.write(
      `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${context}] ${msg}${serialize(meta)}\n`,
    );
  };
  return { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
}
