/**
 * Карта форума forum.minecraft-galaxy.ru: все URL в одном месте.
 *
 * Страницы в URL нумеруются с нуля (`/topic/133931/1` — вторая страница),
 * наружу (в инструменты) — с единицы.
 */
/**
 * Адрес форума. В env его можно переопределить через FORUM_BASE_URL
 * (например, для тестового стенда или прокси). Абсолютные ссылки в
 * тексте постов всегда строятся от этого публичного адреса.
 */
export const DEFAULT_FORUM_URL = "https://forum.minecraft-galaxy.ru";

export const site = {
  /** Главная: список разделов (и популярных разделов сообществ). */
  index: () => "/main/",
  /** Последние темы всех разделов. */
  latest: (page: number) => `/forum/0/${page - 1}`,
  /** Темы раздела общего форума, sectionId 1..11. */
  section: (sectionId: number, page: number) => `/forum/${sectionId}/${page - 1}`,
  /** Страница темы. */
  topic: (topicId: number, page: number) => `/topic/${topicId}/${page - 1}`,
  /** Отдельный пост. */
  post: (postId: number) => `/post/${postId}`,

  /**
   * Список сообществ. sort: 0 — по рейтингу, 1 — по названию, 2 — по темам, 3 — по дате создания,
   * 4 — по постам. title — поиск по подстроке названия (страницы листаются, но ссылок на них нет).
   */
  communities: (sort: number, page: number, title?: string) =>
    `/teams/${sort}/${page - 1}${title ? `?title=${encodeURIComponent(title)}` : ""}`,
  /** Главная сообщества: шапка, описание, кнопки вступить/выйти. */
  community: (communityId: number) => `/hmain/${communityId}`,
  /** Форум сообщества (разделы по категориям). Только под логином. */
  communityForum: (communityId: number) => `/hforum/${communityId}`,
  /** Раздел форума сообщества. id раздела общий для всех сообществ. */
  communitySection: (sectionId: number, page: number) => `/htopic/${sectionId}/${page - 1}`,
  /** Тема сообщества. id тоже общий для всех сообществ. */
  communityTopic: (topicId: number, page: number) => `/hpost/${topicId}/${page - 1}`,
  /** Главная профиля игрока. Профили видны только под логином. */
  profile: (userId: number) => `/profilemain/${userId}`,
  /** Раздел профиля игрока (баны, заходы, приваты…), страница с 1. */
  profileSection: (path: string, userId: number, page: number) => `/${path}/${userId}/${page - 1}`,
  /** Скриншот игрока: карточка и комментарии (доступны и гостю). */
  screenshot: (screenshotId: number) => `/screeninfo/${screenshotId}`,
  screenshotComments: (screenshotId: number, page: number) => `/screencomments/${screenshotId}/${page - 1}`,
  /**
   * Галерея скриншотов. category: game (/screens), other (/screensother), works (/screensworks).
   * filter: 0 все, 1 лучшие, 2 лучшие за неделю, 6 обсуждаемые, 7 обсуждаемые за неделю. userId — один автор.
   */
  screenshotGallery: (category: string, filter: number, page: number, userId?: number) =>
    `/${category}/${filter}/${page - 1}${userId ? `?u=${userId}` : ""}`,
  /** Детали привата (видны всем, кроме скрытых — у них нет владельца и координат). */
  zone: (zoneId: number) => `/zoneinfo/${zoneId}`,
  /** Кто прописан в привате. У скрытого привата закрыто. */
  zoneResidents: (zoneId: number) => `/zonebuilders/${zoneId}`,
  /** Темы из сообществ, где состоит игрок (до 30). Только под логином. */
  myCommunityTopics: () => "/teamforums/",
  /** Свой профиль: в блоке «Сообщества» — где состоит игрок. */
  profileSelf: () => "/profilemain/",
  /** Темы игрока. В URL id игрока + 1 со знаком минус: игрок 714893 → /forum/-714894. */
  userTopics: (userId: number, page: number) => `/forum/-${userId + 1}/${page - 1}`,
  /** Точный поиск игрока по нику (без учёта регистра): [{'id':'714893','login':'nick'}], нет такого → player$0. */
  userExact: (nick: string) => `/object/0/9?q=${encodeURIComponent(nick)}`,
  /** Поиск игроков по началу ника: строки "nick|group|id". */
  userPrefix: (prefix: string) => `/object/0/4?q=${encodeURIComponent(prefix)}`,

  /** Страница с формой логина: из неё берутся скрытые поля (form, ref, fcode, recap). */
  loginPage: () => "/guilogin/",
  /** Куда отправляется форма логина. Успех: 302 на ref, неудача: 302 на /guilogin/4?f=N. */
  loginSubmit: () => "/login.php",
  /** Страница для проверки сессии: ник в шапке есть на любой странице. */
  sessionCheck: () => "/main/",
} as const;

/** "/topic/133931/2#p123" → { kind: "topic", id: 133931, page: 3 } (page с единицы). */
export function parseForumHref(href: string | undefined): { kind: string; id: number; page?: number } | undefined {
  if (!href) return undefined;
  const m = /^(?:https?:\/\/[^/]+)?\/([a-z]+)\/(\d+)(?:\/(\d+))?/.exec(href);
  if (!m) return undefined;
  return { kind: m[1], id: Number(m[2]), page: m[3] !== undefined ? Number(m[3]) + 1 : undefined };
}
