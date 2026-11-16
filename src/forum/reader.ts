import { ForumError } from "./errors.js";
import type { ForumHttp, ForumPage } from "./http.js";
import { ItemResolver, parseUserExact, parseUserPrefix } from "./objects.js";
import { navigation, load } from "./parsers/common.js";
import { parseCommunity, parseCommunityForum, parseCommunityList } from "./parsers/community.js";
import {
  PROFILE_SECTION_PATHS,
  parseProfile,
  parseProfileSection,
  parseZoneInfo,
  parseZoneResidents,
} from "./parsers/profile.js";
import { parseSections, parseTopicList } from "./parsers/topic-list.js";
import { communityFromNav, parsePostPage, parseTopicPage } from "./parsers/topic.js";
import type { PlayerSession } from "./player-session.js";
import { site } from "./site.js";
import type {
  Community,
  CommunityForum,
  CommunityList,
  CommunityTopicList,
  Post,
  PostView,
  Profile,
  ProfileSectionName,
  ProfileSectionPage,
  Section,
  TopicList,
  TopicPage,
  TopicView,
  UserTopicList,
} from "./types.js";

export const DEFAULT_PAGE_SIZE = 15;

/** Сколько живёт разобранная страница темы в кеше: агент обычно листает тему подряд. */
const TOPIC_CACHE_TTL_MS = 60_000;
const TOPIC_CACHE_MAX = 30;
/** Сколько доверяем числу страниц темы, увиденному в списке тем. */
const PAGES_HINT_TTL_MS = 10 * 60_000;
const PAGES_HINT_MAX = 500;
/** Приваты форум отдаёт одной страницей (бывает 400+), листаем сами. */
const ZONES_PAGE_SIZE = 50;

/**
 * Вид темы: обычная (/topic/N) или тема сообщества (/hpost/N). id у них из
 * разных пространств, поэтому вид — часть ключа кешей.
 */
export type TopicKind = "topic" | "hpost";
interface TopicRef {
  kind: TopicKind;
  id: number;
}
const refKey = (ref: TopicRef) => `${ref.kind}:${ref.id}`;

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
 * Чтение форума и сообществ.
 *
 * Без сессии читает гостем (хост). С сессией игрока (stdio с кредами)
 * читает залогиненным, а протухшая сессия переустанавливается сама.
 *
 * Темы (и обычные, и сообществ) отдаются страницами фиксированного размера
 * (по умолчанию 15 постов) поверх пагинации форума, где размер страницы
 * зависит от настроек игрока (15…100). Номера постов (#N) в теме сквозные,
 * включая удалённые, поэтому страница v — это посты #(v-1)*size+1 … #v*size.
 * Без номера страницы — последние size постов: в больших темах обычно нужен конец.
 *
 * Экземпляр долгоживущий: в нём кеш названий предметов, размера страницы
 * форума, числа страниц тем (из списков тем) и недавно прочитанных страниц.
 */
export class ForumReader {
  private readonly items: ItemResolver;
  /** Постов на странице форума у этого читателя (гость или игрок). */
  private forumPageSize?: number;
  private readonly topicCache = new Map<string, { at: number; page: TopicPage }>();
  /** id залогиненного игрока (узнаётся по нику один раз). */
  private ownUserId?: number;
  /** Тема → число страниц форума, увиденное в списке тем: позволяет сразу открыть последнюю. */
  private readonly pagesHint = new Map<string, { at: number; pages: number }>();

  constructor(
    private readonly http: ForumHttp,
    private readonly session?: PlayerSession,
  ) {
    this.items = new ItemResolver(http);
  }

  async sections(): Promise<Section[]> {
    return parseSections(await this.get(site.index()));
  }

  /** Последние темы; под логином сюда же попадают до 10 тем из сообществ игрока (inCommunity). */
  async latestTopics(page = 1): Promise<TopicList> {
    return this.rememberPages(parseTopicList(await this.get(site.latest(page)), page, ["topic", "hpost"]));
  }

  async sectionTopics(sectionId: number, page = 1): Promise<TopicList> {
    return this.rememberPages(parseTopicList(await this.get(site.section(sectionId, page)), page));
  }

  /** Игроки, чей ник начинается с prefix (без учёта регистра). */
  async findUsers(prefix: string, limit = 20): Promise<{ id: number; name: string; group?: string }[]> {
    return parseUserPrefix((await this.http.get(site.userPrefix(prefix))).html).slice(0, limit);
  }

  /** Темы, созданные игроком. Игрок задаётся id или точным ником (регистр не важен). */
  async userTopics(user: { id?: number; nick?: string }, page = 1): Promise<UserTopicList> {
    const id = await this.userIdOf(user);

    const list = parseTopicList(await this.get(site.userTopics(id, page)), page);
    if (list.topics.length === 0 && page > 1) {
      throw new ForumError(`Player ${id} has fewer than ${page} pages of topics`);
    }
    // Заголовок страницы: «Темы пользователя <ник>».
    const name = list.title?.replace(/^Темы пользователя\s+/, "") ?? user.nick ?? String(id);
    return { ...this.rememberPages(list), user: { id, name } };
  }

  // --- Игроки и профили ---

  /** id игрока по точному нику (без учёта регистра); если нет — ошибка с похожими никами. */
  async resolveUserId(nick: string): Promise<number> {
    const clean = nick.trim();
    const found = clean ? parseUserExact((await this.http.get(site.userExact(clean))).html) : undefined;
    if (found) return found.id;
    // Подсказки: ники с тем же началом; при опечатке в середине — по первым 4 буквам.
    let prefix = clean;
    let similar = clean ? await this.findUsers(clean, 10) : [];
    if (similar.length === 0 && clean.length > 4) {
      prefix = clean.slice(0, 4);
      similar = await this.findUsers(prefix, 10);
    }
    throw new ForumError(
      `Player "${clean}" not found.` +
        (similar.length ? ` Nicks starting with "${prefix}": ${similar.map((u) => u.name).join(", ")}` : ""),
    );
  }

  /** Игрок по id или нику; без них — сам залогиненный игрок. */
  private async userIdOf(user: { id?: number; nick?: string }): Promise<number> {
    if (user.id !== undefined) return user.id;
    if (user.nick?.trim()) return this.resolveUserId(user.nick);
    if (!this.session) throw new ForumError("Pass nick or userId");
    // Свой профиль читаем по числовому id: так форум показывает его как чужой, без IP и железа.
    this.ownUserId ??= await this.resolveUserId(await this.session.whoami());
    return this.ownUserId;
  }

  /** Главная профиля. Профили видны только под логином. */
  async profile(user: { id?: number; nick?: string } = {}): Promise<Profile> {
    const id = await this.userIdOf(user);
    return parseProfile(await this.get(site.profile(id)), id);
  }

  /** Раздел профиля (баны, заходы, приваты…). Приваты листаются здесь, по ZONES_PAGE_SIZE. */
  async profileSection(
    user: { id?: number; nick?: string },
    section: ProfileSectionName,
    page = 1,
  ): Promise<ProfileSectionPage> {
    const id = await this.userIdOf(user);
    const local = section === "zones";
    const forumPage = await this.get(site.profileSection(PROFILE_SECTION_PATHS[section], id, local ? 1 : page));
    let { totalPages, data } = parseProfileSection(forumPage, section);
    if (local && Array.isArray(data)) {
      totalPages = Math.max(1, Math.ceil(data.length / ZONES_PAGE_SIZE));
      data = data.slice((page - 1) * ZONES_PAGE_SIZE, page * ZONES_PAGE_SIZE);
    }
    if (page > totalPages) throw new ForumError(`Section ${section} of player ${id} has only ${totalPages} page(s)`);
    return { user: { id }, section, page, totalPages, data };
  }

  /** Детали привата и кто в нём прописан (у скрытого привата жителей не видно). */
  async zone(zoneId: number) {
    const info = parseZoneInfo(await this.get(site.zone(zoneId)), zoneId);
    const residents = parseZoneResidents(await this.get(site.zoneResidents(zoneId)));
    return { ...info, residents };
  }

  // --- Сообщества ---

  /** Список сообществ; title — поиск по подстроке названия. */
  async communities(opts: { sort?: number; page?: number; title?: string } = {}): Promise<CommunityList> {
    const page = opts.page ?? 1;
    return parseCommunityList(await this.get(site.communities(opts.sort ?? 0, page, opts.title)), page);
  }

  /** Главная сообщества; под логином — ещё и состояние членства. */
  async community(communityId: number): Promise<Community> {
    const community = parseCommunity(await this.get(site.community(communityId)), communityId);
    if (community.description) [community.description] = await this.items.resolve([community.description]);
    return community;
  }

  /** Разделы форума сообщества. Только под логином. */
  async communityForum(communityId: number): Promise<CommunityForum> {
    return parseCommunityForum(await this.get(site.communityForum(communityId)), communityId);
  }

  /** Темы раздела сообщества. Гостю открыты только «Общие форумы». */
  async communitySectionTopics(sectionId: number, page = 1): Promise<CommunityTopicList> {
    const forumPage = await this.get(site.communitySection(sectionId, page));
    const list = this.rememberPages(parseTopicList(forumPage, page, ["hpost"]));
    const $ = load(forumPage.html);
    return {
      ...list,
      community: communityFromNav($, navigation($).nav),
      section: { id: sectionId, title: list.title },
    };
  }

  /** Последние темы из сообществ игрока (до 30). Только под логином. */
  async myCommunityTopics(): Promise<TopicList> {
    return this.rememberPages(parseTopicList(await this.get(site.myCommunityTopics()), 1, ["hpost"]));
  }

  // --- Темы ---

  /**
   * page — от начала темы (с 1); без него — последние pageSize постов.
   * kind "hpost" — тема сообщества.
   */
  async topic(
    topicId: number,
    page?: number,
    pageSize = DEFAULT_PAGE_SIZE,
    kind: TopicKind = "topic",
  ): Promise<TopicView> {
    const ref = { kind, id: topicId };
    try {
      return await this.topicSlice(ref, page, pageSize);
    } catch (error) {
      if (!(error instanceof PageSizeChanged)) throw error;
      // Игрок поменял число постов на странице в настройках форума: учимся заново.
      this.forumPageSize = undefined;
      this.topicCache.clear();
      this.pagesHint.clear();
      return this.topicSlice(ref, page, pageSize);
    }
  }

  async post(postId: number, pageSize = DEFAULT_PAGE_SIZE): Promise<PostView> {
    const result = parsePostPage(await this.get(site.post(postId)));
    const { topic, post } = result;

    // На /post/N номер всегда #1; настоящий номер — на странице темы, куда ведёт ссылка.
    let number: number | undefined;
    if (topic.page) {
      const forumPage = await this.forumTopicPage({ kind: "topic", id: topic.id }, topic.page).catch(() => undefined);
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

  private async topicSlice(ref: TopicRef, page: number | undefined, pageSize: number): Promise<TopicView> {
    const layout = await this.layout(ref);
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
          `Topic ${ref.id} has only ${totalPages} page(s) of ${pageSize} posts (${totalPosts} posts)`,
        );
      }
      from = (page - 1) * pageSize + 1;
      to = page * pageSize;
    }

    const posts = await this.collect(ref, layout, from, to);
    // Посты из кеша не трогаем: названия предметов подставляются в копии.
    const copies = structuredClone(posts);
    await this.resolveItems(copies);

    // Шапка (опрос, сообщения, читатели) есть на каждой странице форума.
    const withHeader = page === undefined || page === 1;
    return {
      id: ref.id,
      title: last.title,
      section: last.section,
      community: last.community,
      ...(page === undefined ? { latest: true } : { page }),
      pageSize,
      totalPages,
      totalPosts,
      ...(withHeader ? { poll: last.poll, notices: last.notices, readers: last.readers } : {}),
      posts: copies,
    };
  }

  /** Число страниц форума, размер страницы и последняя страница темы. */
  private async layout(ref: TopicRef): Promise<TopicLayout> {
    // Если тема недавно встречалась в списке — сразу идём на последнюю страницу (1 запрос).
    const hint = this.pagesHint.get(refKey(ref));
    if (hint && Date.now() - hint.at < PAGES_HINT_TTL_MS) {
      const last = await this.forumTopicPage(ref, hint.pages);
      // Тема могла вырасти на новую страницу форума — тогда идём обычным путём.
      if (last.posts.length > 0 && last.totalPages === hint.pages) {
        return this.makeLayout(hint.pages, last);
      }
    }

    const first = await this.forumTopicPage(ref, 1);
    const forumPages = first.totalPages;
    const last = forumPages > 1 ? await this.forumTopicPage(ref, forumPages) : first;
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
  private async collect(ref: TopicRef, layout: TopicLayout, from: number, to: number): Promise<Post[]> {
    const { forumPages, forumPageSize: s, last } = layout;
    if (forumPages === 1) return last.posts.filter((p) => inRange(p, from, to));

    const posts: Post[] = [];
    for (let fp = Math.ceil(from / s); fp <= Math.min(Math.ceil(to / s), forumPages); fp++) {
      const forumPage = fp === forumPages ? last : await this.forumTopicPage(ref, fp);
      const expectedFirst = (fp - 1) * s + 1;
      if (forumPage.posts[0]?.number !== undefined && forumPage.posts[0].number !== expectedFirst) {
        throw new PageSizeChanged();
      }
      posts.push(...forumPage.posts.filter((p) => inRange(p, from, to)));
    }
    return posts;
  }

  /** Страница темы в нумерации форума (с 1), разобранная; кешируется ненадолго. */
  private async forumTopicPage(ref: TopicRef, page: number): Promise<TopicPage> {
    const key = `${refKey(ref)}/${page}`;
    const hit = this.topicCache.get(key);
    if (hit && Date.now() - hit.at < TOPIC_CACHE_TTL_MS) return hit.page;

    const path = ref.kind === "hpost" ? site.communityTopic(ref.id, page) : site.topic(ref.id, page);
    const parsed = parseTopicPage(await this.get(path), ref.id, page);
    if (this.topicCache.size >= TOPIC_CACHE_MAX) {
      this.topicCache.delete(this.topicCache.keys().next().value!);
    }
    this.topicCache.set(key, { at: Date.now(), page: parsed });
    return parsed;
  }

  private rememberPages<T extends TopicList>(list: T): T {
    const at = Date.now();
    for (const t of list.topics) {
      const key = refKey({ kind: t.inCommunity ? "hpost" : "topic", id: t.id });
      this.pagesHint.delete(key); // переставить в конец: Map хранит порядок вставки
      this.pagesHint.set(key, { at, pages: t.pages });
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
