/**
 * Списки разделов и тем. Разметка одинаковая для главной, «последних»
 * (/forum/0), разделов (/forum/N) и разделов сообществ.
 */
import { ForumError, ParseError } from "../errors.js";
import type { ForumPage } from "../http.js";
import { parseForumHref } from "../site.js";
import type { Section, TopicList, TopicRow } from "../types.js";
import { alertText, type Doc, int, load, maxPage, navigation, type Node, stamp, text } from "./common.js";

/** Главная: таблица `forum-table`, строки-заголовки (`td.name`) задают категорию. */
export function parseSections(page: ForumPage, kinds: string[] = ["forum"]): Section[] {
  const $ = load(page.html);
  const sections: Section[] = [];
  let category: string | undefined;

  $("table.forum-table tr").each((_, tr) => {
    const row = $(tr);
    const header = row.children("td.name");
    if (header.length) {
      category = text(header.text());
      return;
    }
    const link = row.find("td.text-row .main-title a").first();
    const target = parseForumHref(link.attr("href"));
    if (!target || !kinds.includes(target.kind)) return;

    const cells = row.children("td");
    sections.push({
      id: target.id,
      category,
      title: text(link.text()),
      description: text(row.find("td.text-row .small").first().text()) || undefined,
      topics: int(cells.eq(2).text()),
      replies: int(cells.eq(3).text()),
      last: stamp(cells.eq(4)),
    });
  });

  if (sections.length === 0) throw new ParseError("section list", page.url);
  return sections;
}

/**
 * Подпись «только для …» → кто может отвечать. Варианты при создании темы:
 * все / только VIP / только Premium и Platinum / только Модераторы.
 */
function parseReplyAccess(label: string): TopicRow["whoCanReply"] {
  if (!label) return "all";
  const l = label.toLowerCase();
  if (l.includes("premium") || l.includes("platinum")) return "premium_platinum";
  if (l.includes("vip")) return "vip";
  if (l.includes("модератор")) return "moderators";
  return label;
}

function parseTopicRow($: Doc, row: Node, kinds: string[]): TopicRow | undefined {
  const cell = row.children("td.text-row").first();
  const link = cell.children("a").first();
  const target = parseForumHref(link.attr("href"));
  if (!target || !kinds.includes(target.kind)) return undefined;

  // Под названием: `<div><span class="admins"><span class="small">только для Модераторов</span></span></div>`,
  // в «последних» ещё и раздел: `<div class="small">Общение - <span class="vip">…только для VIP…</span></div>`.
  const info = cell.children("div").first();
  const replyLabel = text(info.find("span.small").last().text());
  const sectionName = text(info.clone().children().remove().end().text()).replace(/\s*-\s*$/, "") || undefined;

  const cells = row.children("td");
  return {
    id: target.id,
    title: text(link.text()),
    pinned: link.hasClass("t-1"),
    closed: link.find(".main-title-close").length > 0,
    whoCanReply: parseReplyAccess(replyLabel),
    section: info.hasClass("small") ? sectionName : undefined,
    created: stamp(cells.eq(2)),
    replies: int(cells.eq(3).text()),
    pages: maxPage($, cell.children(".pages").first()),
    last: stamp(cells.eq(4)),
  };
}

/** Страница со списком тем: /forum/0, /forum/N, /htopic/N. */
export function parseTopicList(page: ForumPage, pageNum: number, kinds: string[] = ["topic"]): TopicList {
  const $ = load(page.html);
  const topics = $("table.topic-table tr, table.topics:not(.forum-table) tr")
    .map((_, tr) => parseTopicRow($, $(tr), kinds))
    .get()
    .filter((t): t is TopicRow => t !== undefined);

  const { title, totalPages } = navigation($);
  if (topics.length === 0) {
    const alert = alertText($);
    if (alert) throw new ForumError(alert);
    if (!title) throw new ParseError("topic list", page.url);
  }

  // Дубликаты возможны из-за двух селекторов на одну таблицу.
  const unique = [...new Map(topics.map((t) => [t.id, t])).values()];
  return { title, page: pageNum, totalPages: Math.max(totalPages, pageNum), topics: unique };
}
