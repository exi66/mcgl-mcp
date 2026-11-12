import { startFakeForum, type FakeHandler } from "./fake-forum.js";
import { fixture } from "./fixtures.js";

/**
 * Фейковый форум с настоящим потоком логина (страницы — из фикстур):
 * GET /guilogin/ → форма с fcode; POST /login.php → 302 на /main/ с кукой
 * или на /guilogin/4?f=0 с ошибкой; /main/ — гостевая или залогиненная.
 *
 * `kill()` стирает сессии на сервере — имитация протухшего PHPSESSID.
 */
export async function startLoginForum(opts: { login?: string; password?: string; extra?: FakeHandler } = {}) {
  const { login = "Capri", password = "secret" } = opts;
  const sessions = new Set<string>();
  let counter = 0;
  const fcode = /name="fcode" value="(\d+)"/.exec(fixture("guilogin.html"))?.[1];

  const forum = await startFakeForum((req) => {
    const authed = sessions.has(req.cookies.PHPSESSID ?? "");
    if (req.path === "/guilogin/") return { body: fixture("guilogin.html") };
    if (req.path.startsWith("/guilogin/4")) return { body: fixture("guilogin-error.html") };
    if (req.path === "/login.php") {
      const ok = req.form.fcode === fcode && req.form.login === login && req.form.pass === password;
      if (!ok) return { status: 302, headers: { location: "/guilogin/4?f=0" } };
      const sid = `s${++counter}`;
      sessions.add(sid);
      return { status: 302, headers: { location: req.form.ref || "/main/", "set-cookie": `PHPSESSID=${sid}; path=/` } };
    }
    if (req.path === "/main/") return { body: fixture(authed ? "main.authed.html" : "main.html") };
    return opts.extra?.(req);
  });

  return {
    ...forum,
    loginAttempts: () => forum.requests.filter((r) => r.path === "/login.php").length,
    kill: () => sessions.clear(),
  };
}
