import { describe, expect, test } from "vitest";
import { changeMembership } from "../../src/forum/community-actions.js";
import { ForumError } from "../../src/forum/errors.js";
import { PlayerSession } from "../../src/forum/player-session.js";
import type { FakeRequest } from "../helpers/fake-forum.js";
import { fixture } from "../helpers/fixtures.js";
import { startLoginForum } from "../helpers/login-forum.js";

/**
 * Фейк сообществ поверх настоящего потока логина: 253 — открытое (страница
 * зависит от членства), 98 — не проходит по времени игры, 1 — закрытое.
 * Как и настоящий форум, ссылки join/leave без Referer молча ничего не делают.
 */
async function setup(initiallyMember = false) {
  let member = initiallyMember;
  const actions: FakeRequest[] = [];
  const forum = await startLoginForum({
    extra: (req) => {
      if (req.path === "/hmain/253") {
        return { body: fixture(member ? "community-253-member.html" : "community-253-can-join.html") };
      }
      if (req.path === "/hmain/98") return { body: fixture("community-98-blocked.html") };
      if (req.path === "/hmain/1") return { body: fixture("community-1-closed.html") };
      const action = /^\/hmain\/253\/(join|leave)\?_h=token$/.exec(req.path);
      if (action) {
        actions.push(req);
        if (!req.headers.referer?.endsWith("/hmain/253")) return { body: "" };
        member = action[1] === "join";
        return { status: 302, headers: { location: "/hmain/253" } };
      }
    },
  });
  const session = new PlayerSession(forum.http(), { login: "Capri", password: "secret" });
  return { session, actions, isMember: () => member };
}

describe("changeMembership", () => {
  test("join: follows the token link with a Referer and confirms membership", async () => {
    const { session, actions, isMember } = await setup();
    const result = await changeMembership(session, 253, "join");
    expect(isMember()).toBe(true);
    expect(result).toMatchObject({ id: 253, name: "Ивенты Minecraft Galaxy", membership: "member" });
    expect(result).not.toHaveProperty("description");
    expect(actions).toHaveLength(1);
    expect(actions[0].headers.referer).toMatch(/\/hmain\/253$/);
  });

  test("leave", async () => {
    const { session, isMember } = await setup(true);
    const result = await changeMembership(session, 253, "leave");
    expect(isMember()).toBe(false);
    expect(result.membership).toBe("can_join");
  });

  test("join when already a member: no action", async () => {
    const { session, actions } = await setup(true);
    expect((await changeMembership(session, 253, "join")).membership).toBe("member");
    expect(actions).toHaveLength(0);
  });

  test("leave when not a member: error, no action", async () => {
    const { session, actions } = await setup();
    await expect(changeMembership(session, 253, "leave")).rejects.toThrow(/not a member/);
    expect(actions).toHaveLength(0);
  });

  test("blocked by conditions: the forum's reason", async () => {
    const { session } = await setup();
    const error = await changeMembership(session, 98, "join").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForumError);
    expect((error as Error).message).toMatch(/время игры ниже/);
  });

  test("closed community: joining is by application", async () => {
    const { session } = await setup();
    await expect(changeMembership(session, 1, "join")).rejects.toThrow(/closed community/);
  });
});
