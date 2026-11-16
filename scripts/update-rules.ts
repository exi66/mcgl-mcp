/**
 * Обновляет правила форума, которые сервер отдаёт агенту в instructions:
 * `pnpm rules:update`. Берёт «Раздел 2. Правила поведения на форуме» из
 * «Кодекса Галактики» (/wiki/530) и пишет src/mcp/forum-rules.ts.
 *
 * Правила лежат в коде, а не скачиваются при старте: старт не зависит от
 * форума и не замедляется. Запускать, когда правила на форуме поменяются.
 */
import { writeFileSync } from "node:fs";
import { loadForumEnv } from "../src/env.js";
import { ForumHttp } from "../src/forum/http.js";
import { load } from "../src/forum/parsers/common.js";
import { postHtmlToText } from "../src/forum/parsers/content.js";
import { RateLimiter } from "../src/forum/rate-limiter.js";

const PAGE = "/wiki/530";
const SECTION = /^Раздел 2\./;

const http = new ForumHttp(loadForumEnv(), new RateLimiter(0));
const $ = load((await http.get(PAGE)).html);
const part = $(".wiki-part-view")
  .filter((_, p) => SECTION.test($(p).find(".wiki-part-title").first().text().trim()))
  .first();
if (!part.length) throw new Error(`Section ${SECTION} not found on ${PAGE}: the wiki page changed`);

const title = part.find(".wiki-part-title").first().text().trim();
const body = postHtmlToText($, part.find(".wiki-part-body").first());
const date = new Date().toISOString().slice(0, 10);

writeFileSync(
  new URL("../src/mcp/forum-rules.ts", import.meta.url),
  `// Сгенерировано scripts/update-rules.ts (${date}) из https://forum.minecraft-galaxy.ru${PAGE}.
// Не править руками: обновлять через \`pnpm rules:update\`.

export const FORUM_RULES_SOURCE = "https://forum.minecraft-galaxy.ru${PAGE}";

export const FORUM_RULES_TITLE = ${JSON.stringify(title)};

export const FORUM_RULES = ${JSON.stringify(body)};
`,
);
console.log(`src/mcp/forum-rules.ts: "${title}", ${body.length} chars`);
