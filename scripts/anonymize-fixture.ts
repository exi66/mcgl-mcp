/**
 * Обезличивает страницу форума для фикстуры: `tsx scripts/anonymize-fixture.ts <in.html> <out.html>`.
 *
 * Профили и разделы профилей — данные настоящих игроков (баны, заходы,
 * оценки), поэтому в репозиторий они попадают только обезличенными: каждый
 * ник со ссылкой на профиль становится PlayerN, его id — 9000000+N (во всех
 * ссылках: /profilemain/ID, /zones/ID, ?to=ID, showtip(1, ID…) и /forum/-(ID+1)).
 * id меняются только внутри ссылок, а не во всём тексте: иначе короткий id
 * (у system — 4) испортил бы любые числа на странице. Служебные system,
 * GalaxyEvent и тестовый Capri остаются как есть. Токены `_h` → `token`.
 */
import { readFileSync, writeFileSync } from "node:fs";

const KEEP = new Set(["4", "618942", "714940"]); // system, GalaxyEvent, Capri

const [input, output] = process.argv.slice(2);
let html = readFileSync(input, "utf8");

const KEEP_NAMES = new Set(["system", "GalaxyEvent", "Capri"]);
const names = new Map<string, string>();
const ids = new Map<string, string>();
const addId = (id: string) => {
  if (!KEEP.has(id) && id !== "0" && !ids.has(id)) ids.set(id, String(9_000_000 + ids.size + 1));
};
const addName = (nick: string) => {
  const n = nick.trim();
  if (n && !KEEP_NAMES.has(n) && !names.has(n)) names.set(n, `Player${String(names.size + 1).padStart(3, "0")}`);
};

// Ники: ссылки на профиль, а у авторов постов — onPaste("[b]ник[/b]…") и quote("pN-ID", "ник").
for (const [, id, name] of html.matchAll(/<a href=["']\/profilemain\/(\d+)["'][^>]*>([^<]+)<\/a>/g)) {
  if (KEEP.has(id)) continue;
  addId(id);
  addName(name);
}
for (const [, name] of html.matchAll(/onPaste\(\s*"\[b\]([^"[]+)\[\/b\]/g)) addName(name);
for (const [, name] of html.matchAll(/quote\("p\d+-\d+",\s*"([^"]+)"\)/g)) addName(name);
// id игроков в любых ссылках на профиль, ЛС, карму, приваты.
for (const [, id] of html.matchAll(/\/(?:profilemain|userkarma|zones|userscreens)\/(\d+)|[?&]to=(\d+)/g)) {
  if (id) addId(id);
}
for (const [, id] of html.matchAll(/[?&]to=(\d+)/g)) addId(id);
// Владелец профиля: <div class='user-profile-id' id='ID'>; автор в галерее: show_screen("ID", …).
for (const [, id] of html.matchAll(/user-profile-id['"]\s+id=['"](\d+)['"]/g)) addId(id);
for (const [, id] of html.matchAll(/show_screen\("(\d+)"/g)) addId(id);
// «Лучшие авторы» в галерее: <a href="/screens/0?u=ID">ник</a>.
for (const [, id, name] of html.matchAll(/href=["']\/screens\/\d+\?u=(\d+)["'][^>]*>([^<]+)</g)) {
  addId(id);
  addName(name);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Длинные ники первыми, чтобы "Nick" не заменился внутри "Nick2".
for (const [nick, alias] of [...names].sort((a, b) => b[0].length - a[0].length)) {
  html = html.replace(new RegExp(`(?<![\\w$-])${escape(nick)}(?![\\w$-])`, "g"), alias);
}
// id — только в ссылках и вызовах: после "/" или "=" (/profilemain/ID, ?to=ID, ?u=ID) и в showtip(1, ID…).
for (const [id, fake] of ids) {
  html = html.replace(new RegExp(`(?<=[/=]|=['"]|showtip\\(1,\\s*|show_screen\\(")${id}(?!\\d)`, "g"), fake);
}
// Темы игрока: /forum/-(id+1).
html = html.replace(/\/forum\/-(\d+)/g, (m, n: string) => {
  const fake = ids.get(String(Number(n) - 1));
  return fake ? `/forum/-${Number(fake) + 1}` : m;
});
html = html.replace(/_h=[a-z0-9]+/g, "_h=token");

writeFileSync(output, html);
console.log(`${output}: ${names.size} nicks, ${ids.size} ids replaced`);
