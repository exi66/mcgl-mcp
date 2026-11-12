import type { ForumEnv } from "../env.js";
import { createLogger } from "../logger.js";
import { CookieJar } from "./cookie-jar.js";
import { ForumError } from "./errors.js";
import { ForumHealth } from "./health.js";
import type { RateLimiter } from "./rate-limiter.js";

const logger = createLogger("forum-http");

const USER_AGENT = "mcgl-mcp/0.1 (+MCP forum tools)";
const MAX_REDIRECTS = 5;

export interface ForumPage {
  /** Итоговый URL после редиректов. */
  url: string;
  status: number;
  html: string;
}

export type FormFields = Record<string, string | number | undefined>;

export interface ForumHttpOptions {
  /** Общий на процесс circuit breaker. По умолчанию — свой у каждого клиента. */
  health?: ForumHealth;
  /** Паузы перед повторами GET; число повторов = длина массива. По умолчанию 3 попытки: [1000, 2000]. */
  retryDelaysMs?: number[];
}

/** Ответ, после которого GET имеет смысл повторить. */
class RetryableError extends ForumError {}

/**
 * HTTP-клиент к форуму: свой CookieJar, общий RateLimiter, ручные редиректы
 * (чтобы не терять Set-Cookie из 302 после логина), повторы и circuit breaker.
 *
 * - GET при сетевой ошибке, таймауте или 5xx повторяется (по умолчанию 3 попытки).
 * - POST не повторяется: при обрыве неизвестно, дошёл ли запрос, а повтор
 *   отправки поста создал бы дубль.
 * - Если форум лежит (ForumHealth), запрос сразу падает с ForumUnavailableError.
 *
 * Один экземпляр = одна «браузерная сессия». Для анонимного чтения хватает
 * одного общего, для каждого игрока нужен свой.
 */
export class ForumHttp {
  readonly jar = new CookieJar();
  readonly health: ForumHealth;
  private readonly retryDelaysMs: number[];

  constructor(
    private readonly env: ForumEnv,
    private readonly limiter: RateLimiter,
    options: ForumHttpOptions = {},
  ) {
    this.health = options.health ?? new ForumHealth();
    this.retryDelaysMs = options.retryDelaysMs ?? [1000, 2000];
  }

  get(path: string): Promise<ForumPage> {
    return this.withHealth(() => this.withRetries(path, () => this.request(path, { method: "GET" })));
  }

  postForm(path: string, fields: FormFields, extraHeaders?: Record<string, string>): Promise<ForumPage> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) body.append(k, String(v));
    return this.withHealth(() =>
      this.request(path, {
        method: "POST",
        headers: { ...extraHeaders, "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
        body: body.toString(),
      }),
    );
  }

  absoluteUrl(path: string): string {
    return new URL(path, this.env.baseUrl + "/").toString();
  }

  private async withHealth(run: () => Promise<ForumPage>): Promise<ForumPage> {
    this.health.check();
    try {
      const page = await run();
      this.health.success();
      return page;
    } catch (error) {
      // Форум ответил, но что-то не так (редиректы по кругу и т.п.) — он жив.
      if (error instanceof RetryableError) this.health.failure();
      else this.health.success();
      throw error;
    }
  }

  private async withRetries(path: string, run: () => Promise<ForumPage>): Promise<ForumPage> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        const delay = this.retryDelaysMs[attempt];
        if (!(error instanceof RetryableError) || delay === undefined) throw error;
        logger.warn(
          `GET ${path} failed (${error.message}), retry ${attempt + 1}/${this.retryDelaysMs.length} in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private async request(path: string, init: RequestInit): Promise<ForumPage> {
    let url = this.absoluteUrl(path);
    let current: RequestInit = init;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await this.limiter.schedule(() => this.fetchOnce(url, current));
      this.jar.absorb(res.headers);

      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        url = new URL(location, url).toString();
        // 301/302/303 после POST браузеры превращают в GET, повторяем это поведение.
        current = res.status === 307 || res.status === 308 ? current : { method: "GET" };
        continue;
      }

      const html = decode(await res.arrayBuffer(), res.headers.get("content-type"));
      logger.debug(
        `${current.method} ${url} -> ${res.status}${hop ? ` (after ${hop} redirect(s) from ${init.method} ${path})` : ""}`,
      );

      if (res.status >= 500) {
        throw new RetryableError(`Forum returned HTTP ${res.status} for ${url}`);
      }
      return { url, status: res.status, html };
    }

    throw new ForumError(`Too many redirects starting from ${path}`);
  }

  private async fetchOnce(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("user-agent", USER_AGENT);
    headers.set("accept", "text/html,application/xhtml+xml");
    const cookie = this.jar.header();
    if (cookie) headers.set("cookie", cookie);

    try {
      return await fetch(url, {
        ...init,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(this.env.timeoutMs),
      });
    } catch (error) {
      const timeout = error instanceof DOMException && error.name === "TimeoutError";
      throw new RetryableError(timeout ? `Forum timed out: ${url}` : `Request to forum failed: ${url}`, {
        cause: error,
      });
    }
  }
}

/** Форум отдаёт UTF-8 и пишет charset в заголовке; на всякий случай уважаем его. */
function decode(body: ArrayBuffer, contentType: string | null): string {
  const charset = /charset=([^;]+)/i.exec(contentType ?? "")?.[1]?.trim() || "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}
