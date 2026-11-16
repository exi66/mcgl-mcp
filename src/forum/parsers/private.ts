/**
 * Личные сообщения: список переписок (/private/…). Сама переписка
 * (/privatetopic/N) свёрстана как тема и читается тем же парсером.
 */
import { ForumError } from "../errors.js";
import type { ForumPage } from "../http.js";
import { parseForumHref } from "../site.js";
import type { Stamp, UserRef } from "../types.js";
import { alertText, int, load, navigation, stamp, text, userRef } from "./common.js";

export interface Conversation {
  id: number;
  title: string;
  /** Не прочитано мной: у ссылки класс t-1 (жёлтый заголовок). В списках тем тот же класс значит «закреплена». */
  unread?: boolean;
  /** Собеседник ещё не прочитал: иконка во второй колонке. */
  unreadByOther?: boolean;
  from?: UserRef;
  to?: UserRef;
  replies?: number;
  last?: Stamp;
}

/**
 * Таблица `.private-table table.topics`: чекбокс (value = id переписки), иконка «собеседник
 * не прочитал», иконка типа, тема `/privatetopic/N` (#edit-title), от кого, кому, ответов, последнее.
 */
export function parseConversationList(
  page: ForumPage,
  pageNum: number,
): { page: number; totalPages: number; unreadCount?: number; conversations: Conversation[] } {
  const $ = load(page.html);
  const alert = alertText($);
  if (alert) throw new ForumError(alert);

  const conversations: Conversation[] = [];
  $(".private-table table.topics tr").each((_, tr) => {
    const row = $(tr);
    const link = row.find('a[href^="/privatetopic/"]').first();
    const id = parseForumHref(link.attr("href"))?.id;
    if (!id) return;
    const cells = row.children("td");
    conversations.push({
      id,
      title: text(link.find("#edit-title").text()) || text(link.text()),
      unread: link.hasClass("t-1"),
      unreadByOther: cells.eq(1).find("img").length > 0,
      from: userRef(cells.eq(4).find("a.user-link").first()),
      to: userRef(cells.eq(5).find("a.user-link").first()),
      replies: int(cells.eq(6).text()),
      last: stamp(cells.eq(7)),
    });
  });
  const { totalPages } = navigation($);
  // В шапке, в меню «Личные»: «Новые (N)».
  // Ссылок на «Новые» две: вкладка без числа и пункт меню «Новые (N)».
  const unread = $('a[href="/private/0?t=2"]')
    .map((_, a) => /\((\d+)\)/.exec(text($(a).text()))?.[1])
    .get()[0];
  return {
    page: pageNum,
    totalPages: Math.max(totalPages, pageNum),
    unreadCount: unread ? Number(unread) : 0,
    conversations,
  };
}
