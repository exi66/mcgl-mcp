import { readFileSync } from "node:fs";
import type { ForumPage } from "../../src/forum/http.js";

/** Сырой текст фикстуры из test/fixtures (обновляются `pnpm fixtures:update`). */
export function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

/** Фикстура в виде ответа ForumHttp, как её видят парсеры. */
export function page(name: string, url = `https://forum.minecraft-galaxy.ru/${name}`): ForumPage {
  return { url, status: 200, html: fixture(name) };
}
