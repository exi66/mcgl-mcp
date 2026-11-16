/**
 * Профиль игрока: главная (/profilemain/N) и разделы (баны, заходы, приваты…).
 * Только то, что видно и в чужом профиле: IP, железо, родственники, твинки и
 * прочее «только своё» не разбирается.
 */
import { ForumError, ParseError } from "../errors.js";
import type { ForumPage } from "../http.js";
import { parseForumHref } from "../site.js";
import type { Profile, ProfileSectionName, UserRef } from "../types.js";
import { alertText, type Doc, int, load, maxPage, type Node, text, userRef } from "./common.js";
import { postHtmlToText } from "./content.js";

/** Сколько символов текста поста оставлять в оценке: сам пост можно открыть по ссылке. */
const VOTE_EXCERPT = 160;

/**
 * Плашка-ошибка форума вместо содержимого: гостю «Для просмотра профиля необходимо
 * авторизоваться!», закрытый раздел — «Доступ к разделу закрыт!».
 * (Советы в рамке `div.caption` на каждой странице — не ошибка, alertText их не видит.)
 */
function assertNoAlert($: Doc): void {
  const alert = alertText($);
  if (alert) throw new ForumError(alert);
}

function blockItems($: Doc, head: string): Node {
  return $(".profile-block")
    .filter((_, b) => text($(b).children(".head").text()) === head)
    .first()
    .find(".item");
}

/** Пункты блока профиля → { подпись: значение } (подписи форума без двоеточия). */
function blockFields($: Doc, head: string, skip: string[] = []): Record<string, string> {
  const fields: Record<string, string> = {};
  blockItems($, head).each((_, it) => {
    const label = text($(it).children(".title").text()).replace(/:$/, "");
    const value = text($(it).children(".value").text());
    if (label && value && !skip.includes(label)) fields[label] = value;
  });
  return fields;
}

export function parseProfile(page: ForumPage, userId: number): Profile {
  const $ = load(page.html);
  assertNoAlert($);
  if (!$(".profile-block").length) throw new ParseError(`profile ${userId}`, page.url);

  const info = blockFields($, "Информация");
  const name = info["Логин"] ?? "";
  const groups = (info["Группы"] ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  delete info["Логин"];
  delete info["Группы"];

  // «Клан»: первый пункт — ссылка на клан, дальше «Отряд».
  const clanLink = blockItems($, "Клан").find('a[href^="/claninfo/"]').first();
  const clanId = parseForumHref(clanLink.attr("href"))?.id;
  const clanFields = blockFields($, "Клан");

  return {
    id: userId,
    name,
    groups,
    info,
    game: blockFields($, "Игровые достижения"),
    activity: blockFields($, "Активность"),
    resources: blockFields($, "Ресурсы"),
    clan: clanId ? { id: clanId, name: text(clanLink.text()), squad: clanFields["Отряд"] } : undefined,
    communities: blockItems($, "Сообщества")
      .find('a[href^="/hmain/"]')
      .map((_, a) => {
        const target = parseForumHref($(a).attr("href"));
        return target ? { id: target.id, name: text($(a).text()) } : undefined;
      })
      .get()
      .filter((c): c is { id: number; name: string } => c !== undefined),
  };
}

// --- Разделы профиля ---

/** Путь раздела на форуме. */
export const PROFILE_SECTION_PATHS: Record<ProfileSectionName, string> = {
  bans: "userbans",
  freezes: "freeze",
  warnings: "warnlog",
  karma: "userkarma",
  votes: "uservotes",
  friends: "followers",
  game_logins: "gameloginsnew",
  forum_logins: "forumlogins",
  achievements: "userachieve",
  screenshots: "userscreens",
  zones: "zones",
};

interface Row {
  /** Подпись группы над строкой (сервер у приватов и скриншотов). */
  group?: string;
  cells: Node;
}

/** Строки данных таблицы `table.topics`: без заголовка, «(элементов не найдено)» и строк-групп. */
function rows($: Doc, table: Node): Row[] {
  const out: Row[] = [];
  let group: string | undefined;
  // Только строки самой таблицы: в постах внутри оценок бывают свои таблицы.
  table
    .children("tbody")
    .children("tr")
    .add(table.children("tr"))
    .each((i, tr) => {
      if (i === 0) return; // заголовок
      const cells = $(tr).children("td");
      if (cells.length === 1) {
        const label = text(cells.text());
        if (!/элементов не найдено/.test(label)) group = label || undefined;
        return;
      }
      out.push({ group, cells });
    });
  return out;
}

const cellText = (cells: Node, i: number) => text(cells.eq(i).text()) || undefined;
const cellUser = (cells: Node, i: number): UserRef | undefined => userRef(cells.eq(i).find("a").first());
const yes = (cells: Node, i: number) => /\/yes\.png/.test(cells.eq(i).find("img").attr("src") ?? "");
const linkId = (cells: Node, i: number) => parseForumHref(cells.eq(i).find("a").first().attr("href"))?.id;
/** «map: -1806,-404» → «-1806,-404»; «---» (скрыто) → undefined. */
const coords = (s: string | undefined) => (s && s !== "---" ? s.replace(/^map:\s*/, "") : undefined);

function parseBans($: Doc) {
  const [bans, mutes, requests] = $(".content table.topics")
    .toArray()
    .map((t) => rows($, $(t)));
  return {
    bans: (bans ?? []).map(({ cells }) => ({
      days: cellText(cells, 0),
      at: cellText(cells, 1),
      by: cellUser(cells, 2),
      reason: cellText(cells, 3),
    })),
    mutes: (mutes ?? []).map(({ cells }) => ({
      minutes: cellText(cells, 0),
      at: cellText(cells, 1),
      by: cellUser(cells, 2),
      reason: cellText(cells, 3),
    })),
    // Заявки на бан против игрока: нарушенные пункты, статус, кто решил.
    banRequests: (requests ?? []).map(({ cells }) => ({
      id: linkId(cells, 0),
      violation: cellText(cells, 0),
      points: int(cells.eq(1).text()),
      status: cellText(cells, 2),
      decidedBy: cellUser(cells, 3),
      term: cellText(cells, 4),
      at: cellText(cells, 5),
    })),
  };
}

function parseSectionData($: Doc, section: ProfileSectionName): unknown {
  const table = $(".content table.topics").first();
  switch (section) {
    case "bans":
      return parseBans($);
    case "freezes":
      return rows($, table).map(({ cells }) => ({
        by: cellUser(cells, 1),
        at: cellText(cells, 2),
        days: cellText(cells, 3),
        status: cellText(cells, 4),
      }));
    case "warnings":
      return rows($, table).map(({ cells }) => ({
        rule: cellText(cells, 0),
        postId: linkId(cells, 0),
        at: cellText(cells, 1),
      }));
    case "karma": {
      // «За 332 … Против -371 … Итог: -39»
      const all = text($(".content").last().text());
      const num = (re: RegExp) => int(re.exec(all)?.[1]);
      return { plus: num(/За\s*(-?\d+)/), minus: num(/Против\s*(-?\d+)/), total: num(/Итог:\s*(-?\d+)/) };
    }
    case "votes":
      return rows($, table).map(({ cells }) => {
        const body = cells.eq(2);
        const topic = body.children("a").first();
        const post = body.find(".spoler-body").first();
        const excerpt = post.length ? postHtmlToText($, post) : "";
        return {
          from: cellUser(cells, 0),
          vote: yes(cells, 1) ? "+" : "-",
          topic: { id: parseForumHref(topic.attr("href"))?.id, title: text(topic.text()) },
          comment: text(body.children(".frame").first().text()) || undefined,
          post: excerpt.length > VOTE_EXCERPT ? `${excerpt.slice(0, VOTE_EXCERPT)}…` : excerpt || undefined,
          at: cellText(cells, 3),
        };
      });
    case "friends":
      return rows($, table).map(({ cells }) => ({
        ...cellUser(cells, 1),
        confirmed: yes(cells, 0),
        online: cellText(cells, 2),
        addedAt: cellText(cells, 3),
      }));
    case "game_logins":
      // IP и «Компьютер» видны только в своём профиле — не берём.
      return rows($, table).map(({ cells }) => ({
        server: cellText(cells, 0),
        // Вход с железа владельца аккаунта; иначе — гостевой доступ, выданный другому игроку.
        ownHardware: yes(cells, 3),
        start: cellText(cells, 4),
        end: cellText(cells, 5),
        duration: cellText(cells, 6),
      }));
    case "forum_logins":
      return rows($, table).map(({ cells }) => ({
        success: yes(cells, 0),
        at: cellText(cells, 1),
        error: cellText(cells, 3),
      }));
    case "achievements":
      return $(".content .tddesc")
        .map((_, d) => {
          const row = $(d).closest("tr");
          return {
            title: text($(d).find(".title").first().text()),
            description: text($(d).find(".short").first().text()) || undefined,
            progress: text($(d).find(".numbers").first().text()) || undefined,
            // Класс значка: gold, silver…
            type: ($(row).find(".type").attr("class") ?? "").replace(/^type\s*/, "") || undefined,
          };
        })
        .get();
    case "screenshots":
      return rows($, table).map(({ group, cells }) => ({
        id: linkId(cells, 1),
        server: group,
        title: cellText(cells, 1),
        description: cellText(cells, 2),
        rating: int(cells.eq(3).text()),
        addedAt: cellText(cells, 4),
        position: coords(cellText(cells, 5)),
      }));
    case "zones":
      return rows($, table).map(({ group, cells }) => {
        const position = cellText(cells, 4);
        return {
          id: linkId(cells, 1),
          server: group,
          type: cellText(cells, 1),
          name: cellText(cells, 2),
          residents: int(cells.eq(3).text()),
          // Скрытый приват (покупная функция): положение и размеры — «---».
          ...(position === "---" ? { hidden: true } : { position: coords(position), size: cellText(cells, 5) }),
          createdAt: cellText(cells, 6),
          lastVisitAt: cellText(cells, 7),
        };
      });
  }
}

/** Раздел профиля: данные, число страниц (если форум их листает). */
export function parseProfileSection(
  page: ForumPage,
  section: ProfileSectionName,
): { totalPages: number; data: unknown } {
  const $ = load(page.html);
  assertNoAlert($);
  const pages = $(".navigate .pages").first();
  return { totalPages: pages.find("a").length ? maxPage($, pages) : 1, data: parseSectionData($, section) };
}

// --- Приваты (зоны) ---

/**
 * /zoneinfo/N: пункты `.zone-name` / `.zone-place` с подписью `span.title-value`.
 * У скрытой зоны (покупная функция) нет владельца, а «На карте» и «Координаты» — «-».
 */
export function parseZoneInfo(page: ForumPage, zoneId: number) {
  const $ = load(page.html);
  assertNoAlert($);
  const fields: Record<string, string> = {};
  let owner: UserRef | undefined;
  $(".zoneinf-block-info .zone-name, .zoneinf-block-info .zone-place").each((_, el) => {
    const label = text($(el).children(".title-value").text()).replace(/:$/, "");
    if (label === "Владелец") {
      owner = userRef($(el).find("a.user-link").first());
      return;
    }
    const value = text($(el).clone().children(".title-value").remove().end().text()).replace(/^map:\s*/, "");
    if (label) fields[label] = value;
  });
  if (!Object.keys(fields).length) throw new ParseError(`zone ${zoneId}`, page.url);

  const hidden = !fields["Координаты"] || fields["Координаты"] === "-";
  return {
    id: zoneId,
    owner,
    name: fields["Название"],
    server: fields["Планета"],
    createdAt: fields["Создана"],
    ...(hidden ? { hidden } : { position: fields["На карте"], coordinates: fields["Координаты"] }),
    size: fields["Размеры"],
  };
}

/** /zonebuilders/N: кто прописан в зоне. У скрытой зоны — undefined («Вы не можете просматривать…»). */
export function parseZoneResidents(
  page: ForumPage,
): { name: string; id?: number; registeredAt?: string }[] | undefined {
  const $ = load(page.html);
  if (alertText($)) return undefined;
  return rows($, $(".content table.topics").first()).map(({ cells }) => ({
    ...(cellUser(cells, 0) ?? { name: cellText(cells, 0) ?? "" }),
    registeredAt: cellText(cells, 1),
  }));
}
