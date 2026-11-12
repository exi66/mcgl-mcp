export interface UserRef {
  name: string;
  id?: number;
  /**
   * Привилегия игрока из CSS-класса ника: покупная (vip, premium, platinum…) или
   * системная (eventmoder, system…); guest — без привилегий. "girls" — просто цвет
   * ника, его может выбрать любой, к полу отношения не имеет.
   */
  group?: string;
}

export interface Stamp {
  author?: UserRef;
  at?: string;
}

export interface Section {
  id: number;
  category?: string;
  title: string;
  description?: string;
  topics?: number;
  replies?: number;
  last?: Stamp;
}

export type ReplyAccess = "all" | "vip" | "premium_platinum" | "moderators";

export interface TopicRow {
  id: number;
  title: string;
  /** Закреплена вверху раздела. */
  pinned: boolean;
  /** Закрыта: в списке заголовок зачёркнут (`.main-title-close`, line-through). */
  closed: boolean;
  /**
   * Кто может отвечать в теме (задаётся при создании темы). Видно только
   * в списках тем, на странице самой темы форум это не показывает.
   * Неизвестная форумом подпись отдаётся как есть.
   */
  whoCanReply: ReplyAccess | (string & {});
  /** Раздел (есть только в списке последних тем). */
  section?: string;
  created?: Stamp;
  replies?: number;
  /** Сколько страниц в теме. */
  pages: number;
  last?: Stamp;
}

export interface TopicList {
  title?: string;
  page: number;
  totalPages: number;
  topics: TopicRow[];
}

/** Темы, созданные игроком (/forum/-{id+1}). */
export interface UserTopicList extends TopicList {
  user: { id: number; name: string };
}

export interface PostAuthor extends UserRef {
  /** Аккаунт автора удалён или заблокирован (форум показывает его как "player$0"). */
  accountDeleted?: boolean;
  /** Подпись под ником, например "Модератор сообщества". */
  status?: string;
  /** Клан и звание в нём. */
  clan?: { id: number; name: string; rank?: string };
  postCount?: number;
}

export type Post =
  | {
      deleted: false;
      /** Порядковый номер в теме (#N). На странице отдельного поста всегда 1. */
      number?: number;
      id: number;
      author: PostAuthor;
      postedAt?: string;
      text: string;
      /** Рейтинг поста (палец вверх/вниз). */
      rating?: number;
    }
  | {
      deleted: true;
      number?: number;
      id?: number;
    };

export interface Poll {
  id?: number;
  question: string;
  options: { text: string; votes?: number }[];
  totalVotes?: number;
  voters: string[];
}

/** Одна страница темы в том виде, как её отдал форум (размер — по настройкам игрока). */
export interface TopicPage {
  id: number;
  title: string;
  section?: { id: number; title: string };
  page: number;
  totalPages: number;
  poll?: Poll;
  /** Системные сообщения в шапке, например «Этот топик был перемещен из раздела "Общение"». */
  notices: string[];
  /** Кто читает тему прямо сейчас. */
  readers: string[];
  posts: Post[];
}

/**
 * Страница темы для агента: фиксированное число постов (по умолчанию 15),
 * независимо от того, сколько постов форум показывает на своей странице.
 * Без номера страницы — последние посты темы (`latest: true`).
 * Опрос, системные сообщения и читатели — в режиме latest и на первой странице.
 */
export interface TopicView {
  id: number;
  title: string;
  section?: { id: number; title: string };
  /** Номер страницы от начала темы; нет в режиме latest. */
  page?: number;
  latest?: boolean;
  pageSize: number;
  totalPages: number;
  totalPosts: number;
  poll?: Poll;
  notices?: string[];
  readers?: string[];
  posts: Post[];
}

/** Страница отдельного поста, как её отдаёт форум (/post/N). */
export interface PostPage {
  topic: { id: number; title: string; page?: number };
  section?: { id: number; title: string };
  post: Post;
}

/** Пост для агента: с номером в теме и страницей темы (в размере TopicView). */
export interface PostView {
  topic: { id: number; title: string; page?: number };
  section?: { id: number; title: string };
  post: Post;
}
