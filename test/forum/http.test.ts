import { describe, expect, test } from "vitest";
import { CookieJar } from "../../src/forum/cookie-jar.js";
import { ForumError, ForumUnavailableError } from "../../src/forum/errors.js";
import { ForumHealth } from "../../src/forum/health.js";
import { ForumHttp } from "../../src/forum/http.js";
import { RateLimiter } from "../../src/forum/rate-limiter.js";
import { startFakeForum } from "../helpers/fake-forum.js";

describe("CookieJar", () => {
  const headers = (...cookies: string[]) => {
    const h = new Headers();
    for (const c of cookies) h.append("set-cookie", c);
    return h;
  };

  test("stores, overwrites and deletes cookies", () => {
    const jar = new CookieJar();
    jar.absorb(headers("PHPSESSID=abc; path=/; domain=.example.ru", "other=1"));
    expect(jar.header()).toBe("PHPSESSID=abc; other=1");

    jar.absorb(headers("PHPSESSID=def; path=/"));
    expect(jar.header()).toBe("PHPSESSID=def; other=1");

    // Так форум «удаляет» куку: пустое значение / deleted / протухший expires / max-age=0
    jar.absorb(headers("other=deleted", "PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:01 GMT"));
    expect(jar.header()).toBeUndefined();

    jar.absorb(headers("a=1", "b=2; Max-Age=0"));
    expect(jar.header()).toBe("a=1");
  });
});

describe("RateLimiter", () => {
  test("keeps the minimal interval between calls and survives errors", async () => {
    const limiter = new RateLimiter(40);
    const times: number[] = [];
    const run = (fail = false) =>
      limiter.schedule(async () => {
        times.push(Date.now());
        if (fail) throw new Error("boom");
      });

    await Promise.allSettled([run(), run(true), run()]);
    expect(times).toHaveLength(3);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(35);
    }
  });
});

describe("ForumHttp", () => {
  test("follows redirects manually and keeps cookies set on the 302 (login flow)", async () => {
    const forum = await startFakeForum((req) => {
      if (req.path === "/login.php") {
        return { status: 302, headers: { location: "/main/", "set-cookie": "PHPSESSID=s1; path=/" } };
      }
      if (req.path === "/main/") return { body: `session=${req.cookies.PHPSESSID ?? "none"}` };
    });
    const http = forum.http();

    const result = await http.postForm("/login.php", { login: "u" });
    expect(result.url).toBe(`${forum.baseUrl}/main/`);
    expect(result.html).toBe("session=s1");
    // POST → 302 → GET, как в браузере
    expect(forum.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /login.php", "GET /main/"]);
  });

  test("encodes forms as UTF-8 urlencoded (cyrillic, &, +)", async () => {
    const forum = await startFakeForum((req) =>
      req.method === "POST" ? { body: `got: ${req.form.text}` } : undefined,
    );
    const result = await forum.http().postForm("/post", { text: "Привет & пока + ещё" });
    expect(result.html).toBe("got: Привет & пока + ещё");
  });

  test("sends the browser-like headers and extra headers", async () => {
    const forum = await startFakeForum(() => ({ body: "ok" }));
    await forum.http().postForm("/x", { a: 1 }, { "x-requested-with": "XMLHttpRequest" });
    const [req] = forum.requests;
    expect(req.headers["x-requested-with"]).toBe("XMLHttpRequest");
    expect(req.headers["user-agent"]).toMatch(/mcgl-mcp/);
    expect(req.form).toEqual({ a: "1" });
  });

  test("stops on redirect loops", async () => {
    const forum = await startFakeForum(() => ({ status: 302, headers: { location: "/loop" } }));
    await expect(forum.http().get("/loop")).rejects.toThrow(/Too many redirects/);
  });
});

describe("ForumHttp retries", () => {
  test("GET is retried on 5xx and dropped connections, then succeeds", async () => {
    let n = 0;
    const forum = await startFakeForum(() => {
      n++;
      if (n === 1) return { status: 502, body: "bad gateway" };
      if (n === 2) return { destroy: true };
      return { body: "ok" };
    });
    expect((await forum.http().get("/main/")).html).toBe("ok");
    expect(forum.requests).toHaveLength(3);
  });

  test("GET gives up after 3 attempts with a ForumError", async () => {
    const forum = await startFakeForum(() => ({ status: 503, body: "down" }));
    await expect(forum.http().get("/main/")).rejects.toThrow(/HTTP 503/);
    expect(forum.requests).toHaveLength(3);
  });

  test("network errors (nobody listening) are retried and become ForumError", async () => {
    const forum = await startFakeForum(() => undefined);
    const dead = new ForumHttp({ ...forum.env, baseUrl: "http://127.0.0.1:9" }, new RateLimiter(0), {
      retryDelaysMs: [1, 1],
    });
    await expect(dead.get("/main/")).rejects.toBeInstanceOf(ForumError);
  });

  test("4xx is a normal answer, not retried", async () => {
    const forum = await startFakeForum(() => ({ status: 404, body: "nope" }));
    expect((await forum.http().get("/x")).status).toBe(404);
    expect(forum.requests).toHaveLength(1);
  });

  test("POST is never retried (it could duplicate a forum post)", async () => {
    const forum = await startFakeForum(() => ({ status: 502 }));
    await expect(forum.http().postForm("/topic/1", { text: "hi" })).rejects.toBeInstanceOf(ForumError);
    expect(forum.requests).toHaveLength(1);
  });
});

describe("ForumHealth (circuit breaker)", () => {
  test("after repeated failures requests fail fast, then a probe brings it back", async () => {
    let now = 0;
    let down = true;
    const health = new ForumHealth({ failureThreshold: 2, cooldownMs: 30_000, now: () => now });
    const forum = await startFakeForum(() => (down ? { status: 503 } : { body: "ok" }));
    const http = forum.http({ health, retryDelaysMs: [] });

    await expect(http.get("/a")).rejects.toThrow(/HTTP 503/);
    await expect(http.get("/a")).rejects.toThrow(/HTTP 503/);
    expect(health.status).toEqual({ up: false, retryInSec: 30 });

    // Открыт: на форум не ходим вообще.
    const before = forum.requests.length;
    await expect(http.get("/a")).rejects.toBeInstanceOf(ForumUnavailableError);
    expect(forum.requests.length).toBe(before);

    // Cooldown прошёл, форум поднялся: пробный запрос проходит и закрывает breaker.
    now += 30_000;
    down = false;
    expect((await http.get("/a")).html).toBe("ok");
    expect(health.status).toEqual({ up: true });
  });

  test("a failed probe opens the breaker again", async () => {
    let now = 0;
    const health = new ForumHealth({ failureThreshold: 1, cooldownMs: 10_000, now: () => now });
    const forum = await startFakeForum(() => ({ status: 503 }));
    const http = forum.http({ health, retryDelaysMs: [] });

    await expect(http.get("/a")).rejects.toThrow(/HTTP 503/);
    now += 10_000;
    await expect(http.get("/a")).rejects.toThrow(/HTTP 503/); // probe
    await expect(http.get("/a")).rejects.toBeInstanceOf(ForumUnavailableError);
    expect(forum.requests).toHaveLength(2);
  });

  test("forum answering with 4xx or bad markup does not count as down", async () => {
    const health = new ForumHealth({ failureThreshold: 1 });
    const forum = await startFakeForum(() => ({ status: 302, headers: { location: "/loop" } }));
    await expect(forum.http({ health }).get("/loop")).rejects.toThrow(/Too many redirects/);
    expect(health.status.up).toBe(true);
  });
});
