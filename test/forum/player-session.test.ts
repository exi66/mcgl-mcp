import { describe, expect, test } from "vitest";
import { LoginFailedError } from "../../src/forum/errors.js";
import { load } from "../../src/forum/parsers/common.js";
import { PlayerSession, assertAccountUsable } from "../../src/forum/player-session.js";
import { startFakeForum } from "../helpers/fake-forum.js";
import { fixture } from "../helpers/fixtures.js";
import { startLoginForum } from "../helpers/login-forum.js";

describe("PlayerSession", () => {
  test("logs in with the form's hidden fields and reports the username", async () => {
    const forum = await startLoginForum();
    const session = new PlayerSession(forum.http(), { login: "Capri", password: "secret" });

    expect(await session.whoami()).toBe("Capri");

    const post = forum.requests.find((r) => r.path === "/login.php")!;
    // Скрытые поля формы (fcode обязателен) + логин/пароль.
    expect(post.form).toMatchObject({ login: "Capri", pass: "secret", fcode: expect.stringMatching(/^\d+$/) });
    expect(Object.keys(post.form)).toEqual(expect.arrayContaining(["form", "ref", "recap"]));
  });

  test("reuses the session and logs in again once it expires", async () => {
    const forum = await startLoginForum();
    const session = new PlayerSession(forum.http(), { login: "Capri", password: "secret" });

    await session.whoami();
    await session.whoami();
    expect(forum.loginAttempts()).toBe(1);

    forum.kill();
    expect(await session.whoami()).toBe("Capri");
    expect(forum.loginAttempts()).toBe(2);
  });

  test("concurrent calls share one login", async () => {
    const forum = await startLoginForum();
    const session = new PlayerSession(forum.http(), { login: "Capri", password: "secret" });
    await Promise.all([session.whoami(), session.whoami(), session.whoami()]);
    expect(forum.loginAttempts()).toBe(1);
  });

  test("wrong password: forum error message, and no further login attempts", async () => {
    const forum = await startLoginForum();
    const session = new PlayerSession(forum.http(), { login: "Capri", password: "wrong" });

    const error = await session.whoami().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoginFailedError);
    expect((error as Error).message).toMatch(/логин или пароль неверны/);

    // У форума лимит попыток входа: повторно не пробуем.
    await expect(session.whoami()).rejects.toBeInstanceOf(LoginFailedError);
    expect(forum.loginAttempts()).toBe(1);
  });
});

describe("account restrictions after login", () => {
  // Залогиненная страница (ник в шапке), но вместо содержимого — форма кода или блокировка.
  const page = (inner: string) =>
    `<html><body><a href="/profilemain/" class="button button-arrow"><span class="text">Capri</span></a><div class="content">${inner}</div></body></html>`;

  test("two-factor authentication form: clear error", () => {
    expect(() => assertAccountUsable(load(page('<input type="text" name="onepass"/>')))).toThrow(/two-factor/);
  });

  test("IP restriction: clear error", () => {
    const blocked = '<table class="alert"><tr><td class="caption">Доступ к аккаунту заблокирован!</td></tr></table>';
    expect(() => assertAccountUsable(load(page(blocked)))).toThrow(/blocked access from this IP/);
  });

  test("normal page: nothing", () => {
    expect(() => assertAccountUsable(load(page("<p>ok</p>")))).not.toThrow();
  });

  test("2FA right after login counts as a failed login: no retries on every call", async () => {
    let posted = 0;
    const forum = await startFakeForum((req) => {
      if (req.path === "/guilogin/") return { body: fixture("guilogin.html") };
      if (req.path === "/login.php") {
        posted++;
        return { status: 302, headers: { location: "/twofa" } };
      }
      if (req.path === "/twofa") return { body: page('<input type="text" name="onepass"/>') };
    });
    const session = new PlayerSession(forum.http(), { login: "Capri", password: "secret" });
    await expect(session.whoami()).rejects.toBeInstanceOf(LoginFailedError);
    await expect(session.whoami()).rejects.toThrow(/two-factor/);
    expect(posted).toBe(1);
  });
});
