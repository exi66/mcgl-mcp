/**
 * Smoke-тесты на настоящем форуме: `pnpm test:live`. Только чтение и логин.
 * Проверяют, что парсеры по-прежнему понимают живую разметку; конкретный
 * контент не проверяется — он меняется.
 */
import { describe, expect, test } from "vitest";
import { loadForumEnv, loadPlayerCredentials } from "../../src/env.js";
import { ForumHttp } from "../../src/forum/http.js";
import { PlayerSession } from "../../src/forum/player-session.js";
import { RateLimiter } from "../../src/forum/rate-limiter.js";
import { ForumReader } from "../../src/forum/reader.js";

const env = loadForumEnv();
const limiter = new RateLimiter(500);
const reader = new ForumReader(new ForumHttp(env, limiter));

describe("live forum (guest)", () => {
  test("sections, latest topics, a topic and a post", async () => {
    const sections = await reader.sections();
    expect(sections.length).toBeGreaterThanOrEqual(5);

    const latest = await reader.latestTopics();
    expect(latest.topics.length).toBeGreaterThan(0);
    expect(latest.topics.every((t) => t.id > 0 && t.title && t.section)).toBe(true);

    const section = await reader.sectionTopics(sections[0].id);
    expect(section.topics.length).toBeGreaterThan(0);

    const topic = await reader.topic(latest.topics[0].id);
    expect(topic.title).toBeTruthy();
    expect(topic.posts.length).toBeGreaterThan(0);

    const firstLive = topic.posts.find((p) => !p.deleted);
    if (firstLive && !firstLive.deleted) {
      const post = await reader.post(firstLive.id);
      expect(post.topic.id).toBe(topic.id);
    }
  });
});

const credentials = loadPlayerCredentials();

describe.runIf(credentials)("live forum (player from .env)", () => {
  test("login", async () => {
    const session = new PlayerSession(new ForumHttp(env, limiter), credentials!);
    expect(await session.whoami()).toBe(credentials!.login);
  });
});
