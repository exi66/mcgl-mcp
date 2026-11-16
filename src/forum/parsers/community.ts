/**
 * Страницы сообществ: список (/teams/), главная (/hmain/N), форум (/hforum/N),
 * блок «Сообщества» в профиле.
 */
import { ForumError, ParseError } from "../errors.js";
import type { ForumPage } from "../http.js";
import { parseForumHref } from "../site.js";
import type { Community, CommunityForum, CommunityList, CommunityRow, CommunitySection, Membership } from "../types.js";
import { alertText, int, isGuestPage, load, maxPage, stamp, text, userRef } from "./common.js";
import { postHtmlToText } from "./content.js";

/** Сколько сообществ форум показывает на странице списка. */
export const COMMUNITIES_PER_PAGE = 20;

/** Раздел «Общие форумы» открыт всем залогиненным; остальные категории — только участникам. */
const PUBLIC_CATEGORY = "Общие форумы";

/** /teams/{sort}/{page}[?title=]: таблица `teams-table`. */
export function parseCommunityList(page: ForumPage, pageNum: number): CommunityList {
  const $ = load(page.html);
  const communities: CommunityRow[] = [];

  $("table.teams-table tr").each((_, tr) => {
    const row = $(tr);
    const link = row.find('.team-link a[href^="/hmain/"]').first();
    const target = parseForumHref(link.attr("href"));
    if (!target) return;

    // Место: медаль/значок с title «Место в рейтинге: N»; у первого — «Топовое сообщество».
    const badge = row.find(".team-link img").first().attr("title") ?? "";
    const place = /(\d+)/.exec(badge)?.[1] ?? (/Топов/i.test(badge) ? "1" : undefined);
    const cells = row.children("td");
    communities.push({
      id: target.id,
      name: text(link.text()),
      place: place ? Number(place) : undefined,
      leader: userRef(cells.eq(1).find("a.user-link").first()),
      members: int(cells.eq(2).text()),
      open: /\/yes\.png/.test(cells.eq(3).find("img").attr("src") ?? ""),
      topics: int(cells.eq(4).text()),
      posts: int(cells.eq(5).text()),
      createdAt: text(cells.eq(8).text()) || undefined,
    });
  });

  // При поиске (?title=) ссылок на страницы нет, хотя страницы листаются.
  const pages = $(".navigate .pages").first();
  const hasLinks = pages.find("a").length > 0;
  const totalPages = hasLinks ? Math.max(maxPage($, pages), pageNum) : undefined;
  return {
    page: pageNum,
    totalPages,
    hasMore: totalPages !== undefined ? pageNum < totalPages : communities.length >= COMMUNITIES_PER_PAGE,
    communities,
  };
}

/** Состояние игрока по кнопкам на главной сообщества. Гостю кнопок не показывают — undefined. */
function parseMembership(
  $: ReturnType<typeof load>,
  guest: boolean,
): { membership?: Membership; joinBlockedReason?: string } {
  if (guest) return {};
  if ($('a[href*="/leave?_h="]').length) return { membership: "member" };
  if ($('a[href*="/join?_h="]').length) return { membership: "can_join" };
  const reason = alertText($);
  if (reason) return { membership: "blocked", joinBlockedReason: reason };
  return { membership: "closed" };
}

/**
 * /hmain/N. Шапка — первая рамка контента:
 * `<b>Название</b> … Лидер: <a class="user-link">…</a>, участников: 8114, место: 17`.
 */
export function parseCommunity(page: ForumPage, communityId: number): Community {
  const $ = load(page.html);
  const header = $(".content .frame")
    .filter((_, f) => /Лидер:/.test($(f).text()))
    .first();
  if (!header.length) {
    throw new ForumError(alertText($) ?? `Community ${communityId} not found`);
  }
  const headerText = text(header.text());
  const info = $("#info").first();

  return {
    id: communityId,
    name: text(header.find("b").first().text()),
    leader: userRef(header.find("a.user-link").first()),
    members: int(/участников:\s*(\d+)/.exec(headerText)?.[1]),
    place: int(/место:\s*(\d+)/.exec(headerText)?.[1]),
    ...parseMembership($, isGuestPage($)),
    description: info.length ? postHtmlToText($, info) || undefined : undefined,
  };
}

/** /hforum/N: разделы по категориям (`td.delimiter`). Гостю — «необходимо авторизоваться». */
export function parseCommunityForum(page: ForumPage, communityId: number): CommunityForum {
  const $ = load(page.html);
  const sections: CommunitySection[] = [];
  let category: string | undefined;

  $("table.topics tr").each((_, tr) => {
    const row = $(tr);
    const delimiter = row.children("td.delimiter");
    if (delimiter.length) {
      category = text(delimiter.text());
      return;
    }
    const link = row.find('td.text-row a[href^="/htopic/"]').first();
    const target = parseForumHref(link.attr("href"));
    if (!target) return;

    const cells = row.children("td");
    sections.push({
      id: target.id,
      category,
      membersOnly: category !== PUBLIC_CATEGORY,
      title: text(link.text()),
      description: text(row.find("td.text-row .small").first().text()) || undefined,
      topics: int(cells.eq(2).text()),
      replies: int(cells.eq(3).text()),
      last: stamp(cells.eq(4)),
    });
  });

  if (sections.length === 0) {
    const alert = alertText($);
    if (alert) throw new ForumError(alert);
    throw new ParseError("community forum", page.url);
  }

  // Крошек на странице нет; название есть только в <title>: «Ивенты Minecraft Galaxy - Minecraft Galaxy».
  const title = text($("title").first().text()).replace(/\s*-\s*Minecraft Galaxy$/, "") || undefined;
  return { community: { id: communityId, title }, sections };
}

/** Ссылка-действие на главной сообщества: /hmain/N/join?_h=… или /leave?_h=… (токен одноразовый). */
export function actionLink(page: ForumPage, action: "join" | "leave"): string | undefined {
  return load(page.html)(`a[href*="/${action}?_h="]`).first().attr("href");
}
