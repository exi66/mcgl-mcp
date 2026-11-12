/**
 * Страница темы и отдельного поста. Разметка одинаковая во всём форуме
 * (/topic/N, /post/N, темы сообществ).
 */
import { ForumError, ParseError } from "../errors.js";
import type { ForumPage } from "../http.js";
import { parseForumHref } from "../site.js";
import type { Poll, Post, PostAuthor, PostPage, TopicPage } from "../types.js";
import { alertText, type Doc, int, load, navigation, type Node, text, userRef } from "./common.js";
import { postHtmlToText } from "./content.js";

/**
 * Удалённый пост:
 * `<table class="posts"><tr><td class="msg-row"><a href="/post/ID">#N</a>: Этот пост был удален</td></tr></table>`
 */
function parseDeletedPost(table: Node): Post | undefined {
  const link = table.find('td.msg-row > a[href^="/post/"]').first();
  if (!link.length) return undefined;
  return {
    deleted: true,
    number: int(link.text().replace("#", "")),
    id: parseForumHref(link.attr("href"))?.id,
  };
}

function parseAuthor($: Doc, table: Node): PostAuthor {
  const cell = table.find("td.author-row").first();
  const nameLink = cell.find('.login a[href^="javascript"]').first();
  const profile = table.find('.post-tools a[href^="/profilemain/"]').first();
  const id = /\/profilemain\/(\d+)/.exec(profile.attr("href") ?? "")?.[1];

  let status: string | undefined;
  let postCount: number | undefined;
  let clan: PostAuthor["clan"];
  cell.children(".pcount").each((_, el) => {
    const div = $(el);
    const clanLink = div.find('a[href^="/claninfo/"]').first();
    const t = text(div.text());
    const count = /^Ответов:\s*(\d+)/.exec(t);
    if (count) postCount = Number(count[1]);
    else if (clanLink.length) {
      // <a href="/claninfo/117">TheFreezed</a><br/>Legatus
      const rank = text(div.clone().children().remove().end().text()) || undefined;
      clan = { id: parseForumHref(clanLink.attr("href"))?.id ?? 0, name: text(clanLink.text()), rank };
    } else if (t) status = t;
  });

  const name = text(nameLink.text());
  // Удалённый или заблокированный аккаунт: ник "player$0", профиль /profilemain/0.
  if (name === "player$0") return { name, accountDeleted: true, postCount };

  return {
    name,
    id: id && id !== "0" ? Number(id) : undefined,
    group: nameLink.attr("class")?.trim() || undefined,
    status,
    clan,
    postCount,
  };
}

function parsePost($: Doc, table: Node): Post | undefined {
  const body = table.find("div.post-text").first();
  if (!body.length) return parseDeletedPost(table);

  // id="p{номер}-{id поста}"
  const [, number, id] = /^p(\d+)-(\d+)$/.exec(body.attr("id") ?? "") ?? [];
  return {
    deleted: false,
    number: number ? Number(number) : undefined,
    id: Number(id),
    author: parseAuthor($, table),
    postedAt: /\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/.exec(table.find(".post-header").first().text())?.[0],
    text: postHtmlToText($, body),
    rating: int(table.find("table.memo span.vote").first().text()),
  };
}

function parsePosts($: Doc): Post[] {
  return $("table.posts")
    .map((_, t) => parsePost($, $(t)))
    .get()
    .filter((p): p is Post => p !== undefined);
}

/** Опрос: `form[action="/topic/{pollId}/answer"]` между шапкой и постами. */
function parsePoll($: Doc): Poll | undefined {
  const form = $('form[action$="/answer"]').first();
  if (!form.length) return undefined;

  let totalVotes: number | undefined;
  const options: Poll["options"] = [];
  form.find("tr").each((_, tr) => {
    const row = $(tr);
    const label = row.find("label").first();
    if (!label.length) return;
    const [, votes, total] = /\((\d+)\/(\d+)\)/.exec(row.find(".bar .title").text()) ?? [];
    if (total) totalVotes = Number(total);
    options.push({ text: text(label.text()), votes: votes ? Number(votes) : undefined });
  });

  return {
    id: parseForumHref(form.attr("action"))?.id,
    question: text(form.find("th").first().text()),
    options,
    totalVotes,
    voters: form
      .find(".spoler-body a.user-link")
      .map((_, a) => text($(a).text()))
      .get(),
  };
}

/** Рамки между навигацией и постами: «кто читает» и системные сообщения. */
function parseHeaderFrames($: Doc, nav: Node): { readers: string[]; notices: string[] } {
  const readers = $("#topic-read-list a.user-link")
    .map((_, a) => text($(a).text()))
    .get();
  const notices = nav
    .parent()
    .children(".frame")
    .filter((_, f) => $(f).find("#topic-read-list").length === 0)
    .map((_, f) => text($(f).text()))
    .get()
    .filter(Boolean);
  return { readers, notices };
}

/** Раздел из хлебных крошек: последняя ссылка вида /forum/N или /htopic/N. */
function sectionFromNav($: Doc, nav: Node): { id: number; title: string } | undefined {
  let section: { id: number; title: string } | undefined;
  nav.find("a.tree").each((_, a) => {
    const target = parseForumHref($(a).attr("href"));
    if (target && (target.kind === "forum" || target.kind === "htopic")) {
      section = { id: target.id, title: text($(a).text()) };
    }
  });
  return section;
}

export function parseTopicPage(page: ForumPage, topicId: number, pageNum: number): TopicPage {
  const $ = load(page.html);
  const { nav, title, totalPages } = navigation($);
  const posts = parsePosts($);

  if (posts.length === 0) {
    const alert = alertText($);
    if (alert) throw new ForumError(alert);
    if (!title) throw new ParseError("topic", page.url);
    if (pageNum > totalPages) throw new ForumError(`Topic ${topicId} has only ${totalPages} page(s)`);
  }
  if (!title) throw new ParseError("topic title", page.url);

  return {
    id: topicId,
    title,
    section: sectionFromNav($, nav),
    page: pageNum,
    totalPages: Math.max(totalPages, pageNum),
    poll: parsePoll($),
    ...parseHeaderFrames($, nav),
    posts,
  };
}

/** /post/N: крошки ведут на тему (`/topic/ID/PAGE#pN`), ниже один пост. */
export function parsePostPage(page: ForumPage): PostPage {
  const $ = load(page.html);
  const { nav } = navigation($);
  const post = parsePosts($)[0];
  if (!post) throw new ForumError(alertText($) ?? `Post not found (${page.url})`);

  let topic: PostPage["topic"] | undefined;
  nav.find("a.tree").each((_, a) => {
    const target = parseForumHref($(a).attr("href"));
    if (target && (target.kind === "topic" || target.kind === "hpost")) {
      topic = { id: target.id, title: text($(a).text()), page: target.page };
    }
  });
  if (!topic) throw new ParseError("post topic link", page.url);

  // Номер на этой странице всегда #1, настоящий номер в теме неизвестен.
  if (!post.deleted) post.number = undefined;
  return { topic, section: sectionFromNav($, nav), post };
}
