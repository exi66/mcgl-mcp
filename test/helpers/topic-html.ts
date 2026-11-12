/**
 * Синтетическая страница темы в разметке форума (минимум, который читают парсеры).
 * Для тестов логики поверх парсеров (пагинация, кеш), где реальные фикстуры неудобны.
 */
export interface SynthPost {
  number: number;
  id: number;
  deleted?: boolean;
  text?: string;
}

export function topicHtml(opts: { title?: string; posts: SynthPost[]; page: number; totalPages: number; poll?: boolean }) {
  const { title = "Synthetic topic", posts, page, totalPages } = opts;
  const pages = Array.from({ length: totalPages }, (_, i) =>
    i + 1 === page ? `<span class="current">${i + 1}</span>` : `<a href="/topic/1/${i}">${i + 1}</a>`,
  ).join("");

  const postHtml = posts
    .map((p) =>
      p.deleted
        ? `<table class="posts"><tr><td class="msg-row"><a href="/post/${p.id}">#${p.number}</a>: Этот пост был удален</td></tr></table>`
        : `<table class='posts'>
            <tr><td class="author-row" rowspan=2><div class="login"><a class="vip" href='javascript: onPaste("x");'>user${p.number}</a></div>
              <div class="pcount">Ответов: 1</div></td>
            <td class="header-row"><div class="post-header"><a name="p${p.id}"></a><a href="/post/${p.id}">#${p.number}</a>: 2026-01-01 10:00:00
              <span class='post-tools'><a href='/profilemain/${p.number}'>профиль</a></span></div></td></tr>
            <tr><td class="msg-row"><div class="post-text" id="p${p.number}-${p.id}">${p.text ?? `post ${p.number}`}</div></td></tr>
          </table>`,
    )
    .join("");

  const poll = opts.poll
    ? `<form action="/topic/77/answer" method="post"><table class="msg-form"><tr><th>Q?</th></tr>
         <tr><td>1) <label>Yes</label></td><td class="bar"><div class="title">(2/3)</div></td></tr>
         <tr><td>2) <label>No</label></td><td class="bar"><div class="title">(1/3)</div></td></tr></table></form>`
    : "";

  return `<html><body><a class="button" href="/guilogin/">Войти</a><div class="content">
    <div class="navigate"><a class="tree" href="/main/">Форумы</a><a class="tree" href="/forum/4">Общение</a>
      <span class="treesel">${title}</span><span class="pages">${pages}</span></div>
    <div class="frame"><div id="topic-read-list">Этот топик читают: <a href="/profilemain/1" class="user-link guest">Гость</a></div></div>
    ${poll}${postHtml}</div></body></html>`;
}

/**
 * Обработчик фейкового форума для темы из `total` постов при `forumPageSize`
 * постов на странице форума. `pageSize()` можно поменять на лету.
 */
export function syntheticTopic(initialTotal: number, initialForumPageSize: number, opts: { deleted?: number[]; poll?: boolean } = {}) {
  let size = initialForumPageSize;
  let total = initialTotal;
  const all: SynthPost[] = Array.from({ length: 1000 }, (_, i) => ({
    number: i + 1,
    id: 1000 + i + 1,
    deleted: opts.deleted?.includes(i + 1),
  }));
  return {
    setForumPageSize: (s: number) => (size = s),
    /** В тему написали ещё n постов. */
    addPosts: (n: number) => (total += n),
    handle(path: string): string | undefined {
      if (path === "/forum/4/0") return listHtml(Math.max(1, Math.ceil(total / size)));
      const topic = /^\/topic\/1\/(\d+)$/.exec(path);
      if (topic) {
        const page = Number(topic[1]) + 1;
        const totalPages = Math.max(1, Math.ceil(total / size));
        return topicHtml({ posts: all.slice(0, total).slice((page - 1) * size, page * size), page, totalPages, poll: opts.poll });
      }
      const post = /^\/post\/(\d+)$/.exec(path);
      if (post) {
        const p = all.find((x) => x.id === Number(post[1]));
        if (!p) return undefined;
        const forumPage = Math.ceil(p.number / size) - 1;
        // На /post/N крошки ведут на тему со страницей форума, номер поста — всегда #1.
        return topicHtml({ posts: [{ ...p, number: 1 }], page: 1, totalPages: 1 }).replace(
          '<span class="treesel">Synthetic topic</span>',
          `<a class="tree" href="/topic/1/${forumPage}#p${p.id}">Synthetic topic</a>`,
        );
      }
    },
  };
}

/** Список тем раздела с одной темой (id 1) и её числом страниц форума — как в /forum/N. */
export function listHtml(pages: number): string {
  const links = Array.from({ length: pages }, (_, i) => `<a href="/topic/1/${i}">${i + 1}</a>`).join(" ");
  return `<html><body><div class="content">
    <div class="navigate"><a class="tree" href="/main/">Форумы</a><span class="treesel">Общение</span>
      <span class="pages"><span class="current">1</span></span></div>
    <table class="topics topic-table">
      <tr><td class="icon"></td><td class="name">Название</td><td class="author">Автор</td><td class="counter">Ответов</td><td class="datetime">Последнее</td></tr>
      <tr><td class="author-row"></td>
        <td class="text-row"><a class="t-0" href="/topic/1"><span class="main-title">Synthetic topic</span></a>
          <span class="pages">${pages > 1 ? links : ""}</span></td>
        <td class="author-row"><div><a href="/profilemain/1" class="user-link vip">a</a></div><span class="date">2026-01-01 10:00:00</span></td>
        <td class="author-row">0</td>
        <td class="author-row"><div><a href="/profilemain/1" class="user-link vip">a</a></div><span class="date">2026-01-01 10:00:00</span></td></tr>
    </table></div></body></html>`;
}
