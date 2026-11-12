import { DEFAULT_FORUM_URL } from "./forum/site.js";

function str(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function int(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
}

/** Настройки доступа к форуму, общие для обоих режимов. */
export function loadForumEnv() {
  return {
    baseUrl: str("FORUM_BASE_URL", DEFAULT_FORUM_URL).replace(/\/+$/, ""),
    minIntervalMs: int("FORUM_MIN_INTERVAL_MS", 300),
    timeoutMs: int("FORUM_TIMEOUT_MS", 15000),
  };
}

export type ForumEnv = ReturnType<typeof loadForumEnv>;

/**
 * Креды игрока для локального режима. Пользователь сам кладёт их в env
 * в конфиге своего MCP-клиента. Если они не заданы, сервер стартует только
 * с публичными инструментами.
 */
export function loadPlayerCredentials(): { login: string; password: string } | undefined {
  const login = optional("FORUM_LOGIN");
  const password = optional("FORUM_PASSWORD");
  if (!login && !password) return undefined;
  if (!login || !password) {
    throw new Error("FORUM_LOGIN and FORUM_PASSWORD must be set together");
  }
  return { login, password };
}

export function loadHttpEnv() {
  const allowedHosts = optional("ALLOWED_HOSTS")
    ?.split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return {
    host: str("HOST", "0.0.0.0"),
    port: int("PORT", 3000),
    allowedHosts: allowedHosts?.length ? allowedHosts : undefined,
  };
}
