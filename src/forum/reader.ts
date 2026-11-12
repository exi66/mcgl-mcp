import { ForumError } from "./errors.js";
import type { ForumHttp, ForumPage } from "./http.js";
import { ItemResolver } from "./objects.js";
import { parseSections, parseTopicList } from "./parsers/topic-list.js";
import { parsePostPage, parseTopicPage } from "./parsers/topic.js";
import type { PlayerSession } from "./player-session.js";
import { site } from "./site.js";
import type { Post, PostView, Section, TopicList, TopicPage, TopicView } from "./types.js";

export const DEFAULT_PAGE_SIZE = 15;

/** Сколько живёт разобранная страница темы в кеше: агент обычно листает тему подряд. */
const TOPIC_CACHE_TTL_MS = 60_000;
const TOPIC_CACHE_MAX = 30;
/** Сколько доверяем числу страниц темы, увиденному в списке тем. */
const PAGES_HINT_TTL_MS = 10 * 60_000;
const PAGES_HINT_MAX = 500;

/** Как тема разложена по страницам форума. */
interface TopicLayout {
  /** Страниц у темы на форуме. */
  forumPages: number;
  /** Постов на странице форума (Infinity — тема на одной странице). */
  forumPageSize: number;
  /** Последняя страница форума (на ней видно, сколько всего постов). */
  last: TopicPage;
  totalPosts: number;
}

/**
 * Чтение общего форума. Авторизация не нужна.
 *
 * Без сессии читает гостем (хост). С сессией игрока (stdio с кредами)
 * читает залогиненным, а протухшая сессия переустанавливается сама.
 *
 * Темы отдаются страницами фиксированного размера (по умолчанию 15 постов)
 * поверх пагинации форума, где размер страницы зависит от настроек игрока
 * (15…100). Номера постов (#N) в теме сквозные, включая удалённые, поэтому
 * страница v — это посты #(v-1)*size+1 … #v*size. Без номера страницы —
 * последние size постов: в больших темах обычно нужен конец.
 *
 * Экземпляр долгоживущий: в нём кеш названий предметов, размера страницы
 * форума, числа страниц тем (из списков тем) и недавно прочитанных страниц.
 */
export class ForumReader {
  private readonly items: ItemResolver;
  /** Постов на странице форума у этого читателя (гость или игрок). */
  private forumPageSize?: number;
  private readonly topicCache = new Map<string, { at: number; page: TopicPage }>();
  /** topicId → число страниц форума, увиденное в списке тем: позволяет сразу открыть последнюю. */
  private readonly pagesHint = new Map<number, { at: number; pages: number }>();

  constructor(
    private readonly http: ForumHttp,
    private readonly session?: PlayerSession,
  ) {
    this.items = new ItemResolver(http);
  }

  async sections(): Promise<Section[]> {
    return parseSections(await this.get(site.index()));
  }

  async latestTopics(page = 1): Promise<TopicList> {
    return this.rememberPages(parseTopicList(await this.get(site.latest(page)), page));
  }

  async sectionTopics(sectionId: number, page = 1): Promise<TopicList> {
    return this.rememberPages(parseTopicList(await this.get(site.section(sectionId, page)), page));
  }

  /** page — от начала темы (с 1); без него — последние pageSize постов. */
  async topic(topicId: number, page?: number, pageSize = DEFAULT_PAGE_SIZE): Promise<TopicView> {
    try {
      return await this.topicSlice(topicId, page, pageSize);
    } catch (error) {
      if (!(error instanceof PageSizeChanged)) throw error;
      // Игрок поменял число постов на странице в настройках форума: учимся заново.
      this.forumPageSize = undefined;
      this.topicCache.clear();
      this.pagesHint.clear();
      return this.topicSlice(topicId, page, pageSize);
    }
  }

  async post(postId: number, pageSize = DEFAULT_PAGE_SIZE): Promise<PostView> {
    const result = parsePostPage(await this.get(site.post(postId)));
    const { topic, post } = result;

    // На /post/N номер всегда #1; настоящий номер — на странице темы, куда ведёт ссылка.
    let number: number | undefined;
    if (topic.page) {
      const forumPage = await this.forumTopicPage(topic.id, topic.page).catch(() => undefined);
      number = forumPage?.posts.find((p) => p.id === postId)?.number;
    }
    const out: Post = number !== undefined ? { ...post, number } : post;
    await this.resolveItems([out]);
    return {
      ...result,
      topic: { id: topic.id, title: topic.title, page: number ? Math.ceil(number / pageSize) : undefined },
      post: out,
    };
  }

  private async topicSlice(topicId: number, page: number | undefined, pageSize: number): Promise<TopicView> {
    const layout = await this.layout(topicId);
    const { totalPosts, last } = layout;
    const totalPages = Math.max(1, Math.ceil(totalPosts / pageSize));

    let from: number;
    let to: number;
    if (page === undefined) {
      to = totalPosts;
      from = Math.max(1, totalPosts - pageSize + 1);
    } else {
      if (page > totalPages) {
        throw new ForumError(
          `Topic ${topicId} has only ${totalPages} page(s) of ${pageSize} posts (${totalPosts} posts)`,
        );
      }
      from = (page - 1) * pageSize + 1;
      to = page * pageSize;
    }

    const posts = await this.collect(topicId, layout, from, to);
    // Посты из кеша не трогаем: названия предметов подставляются в копии.
    const copies = structuredClone(posts);
    await this.resolveItems(copies);

    // Шапка (опрос, сообщения, читатели) есть на каждой странице форума.
    const withHeader = page === undefined || page === 1;
    return {
      id: topicId,
      title: last.title,
      section: last.section,
      ...(page === undefined ? { latest: true } : { page }),
      pageSize,
      totalPages,
      totalPosts,
      ...(withHeader ? { poll: last.poll, notices: last.notices, readers: last.readers } : {}),
      posts: copies,
    };
  }

  /** Число страниц форума, размер страницы и последняя страница темы. */
  private async layout(topicId: number): Promise<TopicLayout> {
    // Если тема недавно встречалась в списке — сразу идём на последнюю страницу (1 запрос).
    const hint = this.pagesHint.get(topicId);
    if (hint && Date.now() - hint.at < PAGES_HINT_TTL_MS) {
      const last = await this.forumTopicPage(topicId, hint.pages);
      // Тема могла вырасти на новую страницу форума — тогда идём обычным путём.
      if (last.posts.length > 0 && last.totalPages === hint.pages) {
        return this.makeLayout(hint.pages, last);
      }
    }

    const first = await this.forumTopicPage(topicId, 1);
    const forumPages = first.totalPages;
    const last = forumPages > 1 ? await this.forumTopicPage(topicId, forumPages) : first;
    // Первая страница многостраничной темы всегда полная.
    return this.makeLayout(forumPages, last, forumPages > 1 ? first.posts.length : undefined);
  }

  private makeLayout(forumPages: number, last: TopicPage, knownSize?: number): TopicLayout {
    const totalPosts = Math.max(0, ...last.posts.map((p) => p.number ?? 0)) || last.posts.length;
    let size = knownSize;
    if (size === undefined && forumPages > 1) {
      // Первый пост на последней странице: #((forumPages-1)*size+1).
      const firstOnLast = last.posts[0]?.number;
      if (firstOnLast !== undefined) size = (firstOnLast - 1) / (forumPages - 1);
    }
    if (size !== undefined && Number.isInteger(size) && size > 0) this.forumPageSize = size;
    return {
      forumPages,
      forumPageSize: forumPages === 1 ? Infinity : (size ?? this.forumPageSize ?? Infinity),
      last,
      totalPosts,
    };
  }

  /** Посты с номерами from..to, со всех нужных страниц форума. */
  private async collect(topicId: number, layout: TopicLayout, from: number, to: number): Promise<Post[]> {
    const { forumPages, forumPageSize: s, last } = layout;
    if (forumPages === 1) return last.posts.filter((p) => inRange(p, from, to));

    const posts: Post[] = [];
    for (let fp = Math.ceil(from / s); fp <= Math.min(Math.ceil(to / s), forumPages); fp++) {
      const forumPage = fp === forumPages ? last : await this.forumTopicPage(topicId, fp);
      const expectedFirst = (fp - 1) * s + 1;
      if (forumPage.posts[0]?.number !== undefined && forumPage.posts[0].number !== expectedFirst) {
        throw new PageSizeChanged();
      }
      posts.push(...forumPage.posts.filter((p) => inRange(p, from, to)));
    }
    return posts;
  }

  /** Страница темы в нумерации форума (с 1), разобранная; кешируется ненадолго. */
  private async forumTopicPage(topicId: number, page: number): Promise<TopicPage> {
    const key = `${topicId}/${page}`;
    const hit = this.topicCache.get(key);
    if (hit && Date.now() - hit.at < TOPIC_CACHE_TTL_MS) return hit.page;

    const parsed = parseTopicPage(await this.get(site.topic(topicId, page)), topicId, page);
    if (this.topicCache.size >= TOPIC_CACHE_MAX) {
      this.topicCache.delete(this.topicCache.keys().next().value!);
    }
    this.topicCache.set(key, { at: Date.now(), page: parsed });
    return parsed;
  }

  private rememberPages(list: TopicList): TopicList {
    const at = Date.now();
    for (const t of list.topics) {
      this.pagesHint.delete(t.id); // переставить в конец: Map хранит порядок вставки
      this.pagesHint.set(t.id, { at, pages: t.pages });
    }
    while (this.pagesHint.size > PAGES_HINT_MAX) this.pagesHint.delete(this.pagesHint.keys().next().value!);
    return list;
  }

  /** Подставляет названия предметов в тексты постов (на месте). */
  private async resolveItems(posts: Post[]): Promise<void> {
    const live = posts.filter((p): p is Extract<Post, { deleted: false }> => !p.deleted);
    const texts = await this.items.resolve(live.map((p) => p.text));
    live.forEach((p, i) => (p.text = texts[i]));
  }

  private get(path: string): Promise<ForumPage> {
    const session = this.session;
    if (!session) return this.http.get(path);
    return session.withAuth(() => session.getAuthed(path));
  }
}

class PageSizeChanged extends Error {}

function inRange(post: Post, from: number, to: number): boolean {
  return post.number !== undefined && post.number >= from && post.number <= to;
}
