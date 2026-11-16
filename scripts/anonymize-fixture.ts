/**
 * Обезличивает страницу форума для фикстуры: `tsx scripts/anonymize-fixture.ts <in.html> <out.html>`.
 *
 * Профили и разделы профилей — данные настоящих игроков (баны, заходы,
 * оценки), поэтому в репозиторий они попадают только обезличенными: каждый
 * ник со ссылкой на профиль становится PlayerN, его id — 9000000+N (во всех
 * ссылках: /profilemain/ID, /zones/ID, ?to=ID…). Служебный GalaxyEvent и
 * тестовый Capri остаются как есть. Одноразовые токены `_h` заменяются на `token`.
 */
import { readFileSync, writeFileSync } from "node:fs";

const KEEP = new Set(["618942", "714940"]); // GalaxyEvent, Capri

const [input, output] = process.argv.slice(2);
let html = readFileSync(input, "utf8");

const names = new Map<string, string>();
const ids = new Map<string, string>();
for (const [, id, name] of html.matchAll(/<a href=["']\/profilemain\/(\d+)["'][^>]*>([^<]+)<\/a>/g)) {
  if (KEEP.has(id) || id === "0") continue;
  if (!ids.has(id)) ids.set(id, String(9_000_000 + ids.size + 1));
  const nick = name.trim();
  if (nick && !names.has(nick)) names.set(nick, `Player${ids.get(id)!.slice(-3)}`);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Длинные ники первыми, чтобы "Nick" не заменился внутри "Nick2".
for (const [nick, alias] of [...names].sort((a, b) => b[0].length - a[0].length)) {
  html = html.replace(new RegExp(`(?<![\\w$-])${escape(nick)}(?![\\w$-])`, "g"), alias);
}
for (const [id, fake] of ids) html = html.replace(new RegExp(`(?<!\\d)${id}(?!\\d)`, "g"), fake);
html = html.replace(/_h=[a-z0-9]+/g, "_h=token");

writeFileSync(output, html);
console.log(`${output}: ${names.size} nicks, ${ids.size} ids replaced`);
