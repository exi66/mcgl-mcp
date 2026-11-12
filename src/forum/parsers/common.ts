import * as cheerio from "cheerio";
import { DEFAULT_FORUM_URL } from "../site.js";
import type { Stamp, UserRef } from "../types.js";

export type Doc = cheerio.CheerioAPI;
export type Node = ReturnType<Doc>;

/** Публичный адрес форума для абсолютных ссылок в отдаваемых данных. */
export const FORUM_ORIGIN = DEFAULT_FORUM_URL;

export function load(html: string): Doc {
  return cheerio.load(html);
}

export function text(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function int(value: string | undefined | null): number | undefined {
  const t = text(value);
  if (!/^-?\d+$/.test(t)) return undefined;
  return Number(t);
}

export function absUrl(href: string): string {
  return href.startsWith("/") ? FORUM_ORIGIN + href : href;
}

/**
 * Гость: в шапке кнопка «Войти». Форма ответа в теме видна и гостю,
 * поэтому по ней судить о логине нельзя.
 */
export function isGuestPage($: Doc): boolean {
  return $('a.button[href="/guilogin/"]').length > 0;
}

/** Ник залогиненного пользователя из шапки. */
export function currentUser($: Doc): string | undefined {
  return text($('a.button[href="/profilemain/"] .text').first().text()) || undefined;
}

/** Текст плашки-ошибки ("Введенный логин или пароль неверны!…", "У вас нет прав…"). */
export function alertText($: Doc): string | undefined {
  return text($("table.alert td.caption").first().text()) || undefined;
}

const USER_LINK_CLASSES = new Set(["user-link"]);

/** `<a href="/profilemain/123" class="user-link vip">Nick</a>` → {name, id, group}. */
export function userRef(link: Node): UserRef | undefined {
  const name = text(link.text());
  if (!name) return undefined;
  const id = /\/profilemain\/(\d+)/.exec(link.attr("href") ?? "")?.[1];
  const group = (link.attr("class") ?? "").split(/\s+/).find((c) => c && !USER_LINK_CLASSES.has(c));
  return { name, id: id ? Number(id) : undefined, group };
}

/** Ячейка «автор + дата»: `<div><a class="user-link">…</a></div><span class="date">…</span>`. */
export function stamp(cell: Node): Stamp | undefined {
  const author = userRef(cell.find("a.user-link").first());
  const at = text(cell.find(".date").first().text()) || undefined;
  return author || at ? { author, at } : undefined;
}

/** Максимальный номер страницы среди ссылок и текущей страницы в блоке пагинации. */
export function maxPage($: Doc, pages: Node): number {
  const nums = pages
    .find("a, .current")
    .map((_, el) => int($(el).text()))
    .get()
    .filter((n): n is number => n !== undefined);
  return nums.length ? Math.max(...nums) : 1;
}

/** Хлебные крошки и пагинация страницы (`.navigate` вверху контента). */
export function navigation($: Doc) {
  const nav = $(".navigate").first();
  return {
    nav,
    title: text(nav.find(".treesel").first().text()) || undefined,
    totalPages: nav.length ? maxPage($, nav.find(".pages").first()) : 1,
  };
}
