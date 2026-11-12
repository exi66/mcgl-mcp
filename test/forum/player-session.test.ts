import { describe, expect, test } from "vitest";
import { LoginFailedError } from "../../src/forum/errors.js";
import { PlayerSession } from "../../src/forum/player-session.js";
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
