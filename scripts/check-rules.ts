/**
 * Проверяет, не поменялись ли правила форума: `pnpm rules:check`.
 *
 * Агенту отдаётся сжатый список запретов (src/mcp/forum-rules.ts), составленный
 * вручную по «Разделу 2. Правила поведения на форуме» из «Кодекса Галактики»
 * (/wiki/530). Скрипт скачивает этот раздел, считает хеш текста и сравнивает
 * с FORUM_RULES_SECTION_HASH. Не совпало — правила на форуме изменились:
 * скрипт печатает актуальный текст, список надо пересмотреть и обновить хеш.
 */
import { createHash } from "node:crypto";
import { loadForumEnv } from "../src/env.js";
import { ForumHttp } from "../src/forum/http.js";
import { load } from "../src/forum/parsers/common.js";
import { postHtmlToText } from "../src/forum/parsers/content.js";
import { RateLimiter } from "../src/forum/rate-limiter.js";
import { FORUM_RULES_SECTION_HASH, FORUM_RULES_SOURCE } from "../src/mcp/forum-rules.js";

const SECTION = /^Раздел 2\./;

const http = new ForumHttp(loadForumEnv(), new RateLimiter(0));
const $ = load((await http.get(new URL(FORUM_RULES_SOURCE).pathname)).html);
const part = $(".wiki-part-view")
  .filter((_, p) => SECTION.test($(p).find(".wiki-part-title").first().text().trim()))
  .first();
if (!part.length) throw new Error(`Section ${SECTION} not found on ${FORUM_RULES_SOURCE}: the wiki page changed`);

const text = postHtmlToText($, part.find(".wiki-part-body").first());
const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);

if (hash === FORUM_RULES_SECTION_HASH) {
  console.log(`Forum rules unchanged (${hash}).`);
} else {
  console.log(text);
  console.error(
    `\nForum rules changed: ${FORUM_RULES_SECTION_HASH} -> ${hash}. ` +
      "Review the list in src/mcp/forum-rules.ts against the text above and update FORUM_RULES_SECTION_HASH.",
  );
  process.exitCode = 1;
}
