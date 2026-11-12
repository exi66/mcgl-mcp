/**
 * Проверка авторизации без MCP: `pnpm check:login` (креды из .env).
 *
 * 1. логин;
 * 2. повторная проверка сессии по той же куке;
 * 3. имитация протухшей сессии (куки стираются) и автоматический перелогин.
 *
 * Каждый запуск тратит 2 входа. Неверный пароль тратит попытку из лимита форума.
 */
import { loadForumEnv, loadPlayerCredentials } from "../env.js";
import { ForumHttp } from "../forum/http.js";
import { PlayerSession } from "../forum/player-session.js";
import { RateLimiter } from "../forum/rate-limiter.js";

const credentials = loadPlayerCredentials();
if (!credentials) {
  console.error("Set FORUM_LOGIN and FORUM_PASSWORD in .env");
  process.exit(1);
}

const forumEnv = loadForumEnv();
const http = new ForumHttp(forumEnv, new RateLimiter(forumEnv.minIntervalMs));
const session = new PlayerSession(http, credentials);

const step = async (name: string, fn: () => Promise<string>) => {
  try {
    console.log(`OK   ${name}: ${await fn()}`);
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
};

await step("login", () => session.whoami());
await step("session reuse", () => session.whoami());
http.jar.clear();
await step("relogin after expired session", () => session.whoami());
