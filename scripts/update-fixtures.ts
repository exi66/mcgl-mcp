/**
 * Скачивает страницы форума в test/fixtures/ для тестов парсеров: `pnpm fixtures:update`.
 *
 * Фикстуры коммитятся и не меняются сами: тесты детерминированные. Перекачивать
 * их стоит, когда форум поменял разметку (тогда упадут тесты и будет видно что).
 * Контент тем при этом тоже обновится, поэтому тесты опираются на старые
 * темы, которые уже не меняются.
 *
 * С FORUM_LOGIN/FORUM_PASSWORD в .env дополнительно сохраняется главная под
 * игроком (main.authed.html) — для тестов определения гостя/ника.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadForumEnv, loadPlayerCredentials } from "../src/env.js";
import { ForumHttp } from "../src/forum/http.js";
import { PlayerSession } from "../src/forum/player-session.js";
import { RateLimiter } from "../src/forum/rate-limiter.js";

const DIR = new URL("../test/fixtures/", import.meta.url);

/** имя файла → путь на форуме */
const GUEST_PAGES: Record<string, string> = {
  "main.html": "/main/",
  "latest.html": "/forum/0/0",
  "section-4.html": "/forum/4/0",
  "section-missing.html": "/forum/9/0",
  // Большая тема с опросом, 2 страницы, первый пост от удалённого аккаунта (player$0)
  "topic-133931-p1.html": "/topic/133931/0",
  "topic-133931-p2.html": "/topic/133931/1",
  // «Этот топик был перемещен из раздела …»
  "topic-134090.html": "/topic/134090/0",
  // Первый пост удалён
  "topic-134087.html": "/topic/134087/0",
  "post-2120899.html": "/post/2120899",
  // Справка по bbCode: отрендеренные примеры всех тегов
  "wiki-bbcode.html": "/wiki/201",
  "guilogin.html": "/guilogin/",
  "guilogin-error.html": "/guilogin/4?f=0",
  "object-item-41.txt": "/object/41/2",
  "object-item-35-14.txt": "/object/35/2?d=14",
  "object-item-missing.txt": "/object/999999/2",
};

const env = loadForumEnv();
const limiter = new RateLimiter(500);
mkdirSync(DIR, { recursive: true });

const save = (name: string, body: string) => {
  writeFileSync(new URL(name, DIR), body);
  console.log(`saved ${name} (${body.length} chars)`);
};

const guest = new ForumHttp(env, limiter);
for (const [name, path] of Object.entries(GUEST_PAGES)) {
  save(name, (await guest.get(path)).html);
}

const credentials = loadPlayerCredentials();
if (credentials) {
  const session = new PlayerSession(new ForumHttp(env, limiter), credentials);
  await session.whoami();
  save("main.authed.html", (await session.getAuthed("/main/")).html);
} else {
  console.log("FORUM_LOGIN/FORUM_PASSWORD not set: main.authed.html skipped");
}
