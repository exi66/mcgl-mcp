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
