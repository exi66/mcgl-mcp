import { createLogger } from "../logger.js";
import type { ForumHttp } from "./http.js";

const logger = createLogger("objects");

/**
 * Эндпоинт всплывающих подсказок форума: `/object/{id}/{type}`.
 * Тип 1 — игрок, 2 — предмет (`?d=` — метадата), 3 — сообщество, 4 — игроки по началу ника,
 * 5/6 — свои твинки/друзья (не используем), 7 — администрация и модераторы, 8 — хелперы,
 * 9 — игрок по точному нику, 10 — клан. Обработчик — pages/object.php в исходниках движка.
 * Ответ — JS-объект в одинарных кавычках (форум делает ему eval), пустой ответ — нет такого объекта:
 *   {'_type':'2','id':'41','title':'Золотой блок','info':'Используется для декора…'}
 */
export function parseObjectLiteral(raw: string): Record<string, string> | undefined {
  const body = raw.trim();
  if (!body.startsWith("{")) return undefined;
  const result: Record<string, string> = {};
  for (const [, key, value] of body.matchAll(/'([^']+)'\s*:\s*'((?:\\.|[^'\\])*)'/g)) {
    result[key] = value.replace(/\\(.)/g, "$1");
  }
  return Object.keys(result).length ? result : undefined;
}

/**
 * Ответ точного поиска игрока `/object/0/9?q=nick`: `[{'id':'714893','login':'pozziittiivo'}]`.
 * Если игрока нет, форум отвечает `player$0` с id 0 — тогда undefined.
 */
export function parseUserExact(raw: string): { id: number; name: string } | undefined {
  const obj = parseObjectLiteral(raw.trim().replace(/^\[/, "").replace(/\]$/, ""));
  const id = Number(obj?.id);
  if (!obj?.login || !Number.isInteger(id) || id <= 0) return undefined;
  return { id, name: obj.login };
}

/**
 * Ответ поиска по началу ника `/object/0/4?q=prefix`: строки `nick|group|id`.
 * Пустые строки (`|guest|`) и удалённые аккаунты (`player$N`) отбрасываются.
 */
export function parseUserPrefix(raw: string): { id: number; name: string; group?: string }[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().split("|"))
    .filter(([name, , id]) => name && !/^player\$\d+$/.test(name) && Number(id) > 0)
    .map(([name, group, id]) => ({ id: Number(id), name, group: group || undefined }));
}

/**
 * Списки `/object/0/7` и `/object/0/8`: `{'_type':7, 'items':[{'id':'1','login':'admin','group':'admins'},…]}`.
 * Внешний объект не в формате parseObjectLiteral (ключ `_type` без кавычек у значения), поэтому берём элементы.
 */
export function parseObjectItems(raw: string): Record<string, string>[] {
  const list = /'items'\s*:\s*\[([\s\S]*)\]/.exec(raw)?.[1] ?? "";
  return [...list.matchAll(/\{[^{}]*\}/g)].map(([item]) => parseObjectLiteral(item)).filter((o) => o !== undefined);
}

/** Профессии в игре (`prof` в карточке игрока), по /professions/ и иконкам /img/prof/N.png. 0 — без профессии. */
export const PROFESSIONS: Record<number, string> = {
  1: "Чернорабочий",
  2: "Кузнец",
  3: "Строитель",
  4: "Шахтёр",
  5: "Охотник",
  6: "Инженер",
  7: "Медик",
};

const num = (value: string | undefined) => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) ? n : undefined;
};

export interface PlayerCard {
  id: number;
  name: string;
  registered?: string;
  lastLogin?: string;
  profession?: string;
  blocksPlaced?: number;
  blocksBroken?: number;
  forumRating?: number;
  forumPosts?: number;
  /** Действующие баны (не снятые) и все за всё время. */
  activeBans?: number;
  bansTotal?: number;
}

/** Карточка игрока `/object/{id}/1` — видна и гостю (в отличие от профиля). */
export function parsePlayerCard(raw: string): PlayerCard | undefined {
  const o = parseObjectLiteral(raw);
  const id = num(o?.id);
  if (!o?.login || !id) return undefined;
  const prof = num(o.prof);
  return {
    id,
    name: o.login,
    registered: o.register || undefined,
    lastLogin: o.last_login || undefined,
    profession: prof ? (PROFESSIONS[prof] ?? `#${prof}`) : undefined,
    blocksPlaced: num(o.make),
    blocksBroken: num(o.crush),
    forumRating: num(o.rating),
    forumPosts: num(o.posts),
    activeBans: num(o.bans),
    bansTotal: num(o.bansall),
  };
}

export interface ClanCard {
  id: number;
  name: string;
  leader?: string;
  members?: number;
  place?: number;
  wars?: number;
  unions?: number;
  level?: number;
}

/** Клан `/object/{id}/10`: войны и союзы — число активных. */
export function parseClanCard(raw: string): ClanCard | undefined {
  const o = parseObjectLiteral(raw);
  const id = num(o?.id);
  if (!o?.name || !id) return undefined;
  return {
    id,
    name: o.name,
    leader: o.leader || undefined,
    members: num(o.members),
    place: num(o.place),
    wars: num(o.wars),
    unions: num(o.unions),
    level: num(o.level),
  };
}

/** Сводка сообщества `/object/{id}/3`: дата создания, темы, посты, открыт ли набор (`public`). */
export function parseCommunityCard(
  raw: string,
): { created?: string; topics?: number; posts?: number; open: boolean } | undefined {
  const o = parseObjectLiteral(raw);
  if (!o?.name) return undefined;
  return { created: o.time || undefined, topics: num(o.topics), posts: num(o.posts), open: o.public === "1" };
}

export interface ItemInfo {
  id: number;
  meta: number;
  title: string;
  info?: string;
}

/** Маркер предмета в тексте поста, который ставит content.ts и раскрывает ItemResolver. */
export const ITEM_TOKEN = /⟦item:(\d+):(\d+)⟧/g;
export const itemToken = (id: number, meta: number) => `⟦item:${id}:${meta}⟧`;
/** Легенда к окну крафта: список предметов через ";". */
export const LEGEND_TOKEN = /⟦legend:([\d:;]+)⟧/g;
export const legendToken = (items: [number, number][]) => `⟦legend:${items.map(([i, m]) => `${i}:${m}`).join(";")}⟧`;

/**
 * Названия предметов по id и метадате. Предметы не меняются, поэтому кеш
 * живёт весь процесс и общий для всех запросов. За один вызов resolve
 * делается не больше `maxLookups` новых запросов к форуму; остальные
 * предметы остаются в виде «item #id».
 */
export class ItemResolver {
  private readonly cache = new Map<string, Promise<ItemInfo | undefined>>();

  constructor(
    private readonly http: ForumHttp,
    private readonly maxLookups = 25,
  ) {}

  /** Подставляет названия вместо маркеров во всех переданных текстах. */
  async resolve(texts: string[]): Promise<string[]> {
    const wanted = new Set<string>();
    for (const t of texts) {
      for (const [, id, meta] of t.matchAll(ITEM_TOKEN)) wanted.add(`${id}:${meta}`);
      for (const [, list] of t.matchAll(LEGEND_TOKEN)) list.split(";").forEach((k) => wanted.add(k));
    }

    let budget = this.maxLookups;
    const known = new Map<string, ItemInfo | undefined>();
    for (const key of wanted) {
      if (!this.cache.has(key)) {
        if (budget-- <= 0) continue;
        const [id, meta] = key.split(":").map(Number);
        this.cache.set(key, this.fetchItem(id, meta));
      }
      known.set(key, await this.cache.get(key));
    }

    const shortKey = (key: string) => (key.endsWith(":0") ? key.slice(0, -2) : key);
    const name = (key: string) => known.get(key)?.title ?? "item";
    // "Золотой блок #41", "Красная шерсть #35:14", без названия — "item #41".
    const label = (key: string) => `${name(key)} #${shortKey(key)}`;

    return texts.map((t) =>
      t
        .replace(ITEM_TOKEN, (_, id, meta) => `[${label(`${id}:${meta}`)}]`)
        .replace(LEGEND_TOKEN, (_, list: string) =>
          list
            .split(";")
            .filter((k, i, all) => all.indexOf(k) === i)
            .map((k) => `${shortKey(k)} = ${name(k)}`)
            .join("\n"),
        ),
    );
  }

  private async fetchItem(id: number, meta: number): Promise<ItemInfo | undefined> {
    try {
      const page = await this.http.get(`/object/${id}/2${meta ? `?d=${meta}` : ""}`);
      const obj = parseObjectLiteral(page.html);
      if (!obj?.title) return undefined;
      return { id, meta, title: obj.title, info: obj.info || undefined };
    } catch (error) {
      // Не кешируем сбой сети: в следующий раз попробуем снова.
      this.cache.delete(`${id}:${meta}`);
      logger.warn(`Item ${id}:${meta} lookup failed`, error);
      return undefined;
    }
  }
}
