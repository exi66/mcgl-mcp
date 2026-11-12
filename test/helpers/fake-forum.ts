import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach } from "vitest";
import type { ForumEnv } from "../../src/env.js";
import { ForumHttp, type ForumHttpOptions } from "../../src/forum/http.js";
import { RateLimiter } from "../../src/forum/rate-limiter.js";

export interface FakeRequest {
  method: string;
  /** Путь с query, например "/topic/1/0" или "/object/41/2?d=0". */
  path: string;
  headers: IncomingMessage["headers"];
  cookies: Record<string, string>;
  /** Тело POST, раскодированное из urlencoded. */
  form: Record<string, string>;
}

export interface FakeResponse {
  status?: number;
  headers?: Record<string, string | string[]>;
  body?: string;
  /** Оборвать соединение без ответа (имитация лежащего форума). */
  destroy?: boolean;
}

export type FakeHandler = (req: FakeRequest) => FakeResponse | undefined;

export interface FakeForum {
  baseUrl: string;
  requests: FakeRequest[];
  env: ForumEnv;
  /**
   * Новый ForumHttp (свои куки) на этот фейковый форум без задержек между
   * запросами и с мгновенными повторами (если не переопределено в options).
   */
  http(options?: ForumHttpOptions): ForumHttp;
}

const servers: { close(): void; closeAllConnections(): void }[] = [];
afterEach(() => {
  while (servers.length) {
    const s = servers.pop()!;
    s.closeAllConnections();
    s.close();
  }
});

/**
 * Локальный http-сервер, изображающий форум. Неотвеченные запросы → 404.
 * Сервер закрывается автоматически после каждого теста.
 */
export async function startFakeForum(handler: FakeHandler): Promise<FakeForum> {
  const requests: FakeRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const fake: FakeRequest = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        cookies: parseCookies(req.headers.cookie),
        form: Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))),
      };
      requests.push(fake);
      const reply = handler(fake) ?? { status: 404, body: "not found" };
      if (reply.destroy) {
        req.socket.destroy();
        return;
      }
      res.writeHead(reply.status ?? 200, { "content-type": "text/html; charset=UTF-8", ...reply.headers });
      res.end(reply.body ?? "");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);

  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const env: ForumEnv = { baseUrl, minIntervalMs: 0, timeoutMs: 2000 };
  return {
    baseUrl,
    requests,
    env,
    http: (options) => new ForumHttp(env, new RateLimiter(0), { retryDelaysMs: [1, 1], ...options }),
  };
}

function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, v.join("=")]),
  );
}
