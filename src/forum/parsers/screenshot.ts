/**
 * Скриншот игрока: /screeninfo/N (карточка) и /screencomments/N (комментарии —
 * та же разметка, что у постов темы). Обе страницы доступны и гостю.
 */
import { ForumError } from "../errors.js";
import type { ForumPage } from "../http.js";
import type { Post, UserRef } from "../types.js";
import { absUrl, alertText, int, load, navigation, text, userRef } from "./common.js";
import { parsePosts } from "./topic.js";

export interface Screenshot {
  id: number;
  title?: string;
  author?: UserRef;
  /** Раздел скриншотов игрока (бывает пустым). */
  section?: string;
  rating?: number;
  /** Полноразмерная картинка (на странице — превью /cache/img/N.jpg). */
  image?: string;
}

/** «Подпись: значение» внутри `.screen`: `<div><span class="title-value">Автор: </span>…</div>`. */
export function parseScreenshot(page: ForumPage, screenshotId: number): Screenshot {
  const $ = load(page.html);
  const screen = $(".content .screen").first();
  if (!screen.length) throw new ForumError(alertText($) ?? `Screenshot ${screenshotId} not found`);

  // Подписи лежат рядом с .screen, в той же рамке.
  const box = screen.closest(".frame");
  const field = (label: string) =>
    box
      .find(".title-value")
      .filter((_, el) => text($(el).text()).replace(/:$/, "") === label)
      .first()
      .parent();

  const img = screen.find("img").first();
  // onclick="show_preview(this, '/png/screens/Nick/186951.jpg')"
  const full = /show_preview\(this,\s*'([^']+)'/.exec(img.attr("onclick") ?? "")?.[1];
  const without = (el: ReturnType<typeof field>) => text(el.clone().children(".title-value").remove().end().text());

  return {
    id: screenshotId,
    title: without(field("Название")) || img.attr("alt") || undefined,
    author: userRef(field("Автор").find("a.user-link").first()),
    section: text(field("Раздел").find("a").first().text()) || undefined,
    rating: int(without(field("Рейтинг"))),
    image: full ? absUrl(full) : img.attr("src") ? absUrl(img.attr("src")!) : undefined,
  };
}

export function parseScreenshotComments(
  page: ForumPage,
  pageNum: number,
): { page: number; totalPages: number; comments: Post[] } {
  const $ = load(page.html);
  const alert = alertText($);
  if (alert) throw new ForumError(alert);
  const { totalPages } = navigation($);
  return { page: pageNum, totalPages: Math.max(totalPages, pageNum), comments: parsePosts($) };
}

/** Плитка галереи скриншотов. */
export interface ScreenshotTile {
  id: number;
  title?: string;
  author?: UserRef;
  rating?: number;
  comments?: number;
  position?: string;
}

/**
 * Галерея /screens|screensother|screensworks/{фильтр}/{стр}[?u=id]: плитки `.item`
 * с названием, координатами, числом комментариев, автором и рейтингом. id скриншота —
 * в onclick='show_screen("<id автора>", "<id скриншота>")'.
 */
export function parseScreenshotGallery(
  page: ForumPage,
  pageNum: number,
): { page: number; totalPages: number; screenshots: ScreenshotTile[] } {
  const $ = load(page.html);
  const alert = alertText($);
  if (alert) throw new ForumError(alert);

  const screenshots: ScreenshotTile[] = [];
  $(".content .item").each((_, el) => {
    const item = $(el);
    // id — из ссылки на комментарии: она есть во всех категориях (в «Игровых» картинка
    // открывается через show_screen("<id автора>", id), в «Разных»/«Работах» — show_custom_screen("<ник>", id)).
    const id =
      /\/screencomments\/(\d+)/.exec(item.find(".screen-comments a").attr("href") ?? "")?.[1] ??
      /show_(?:custom_)?screen\(\s*"[^"]*",\s*"(\d+)"/.exec(item.find("img[onclick]").attr("onclick") ?? "")?.[1];
    if (!id) return;
    screenshots.push({
      id: Number(id),
      title: text(item.find(".title").first().text()) || undefined,
      author: userRef(item.find(".author a.user-link").first()),
      rating: int(item.find(".vote-simple").first().text()),
      comments: int(item.find(".screen-comments").first().text()),
      position: text(item.find(".map-coords a").first().text()) || undefined,
    });
  });
  const { totalPages } = navigation($);
  return { page: pageNum, totalPages: Math.max(totalPages, pageNum), screenshots };
}
