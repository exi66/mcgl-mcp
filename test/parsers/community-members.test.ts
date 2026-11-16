import { describe, expect, test } from "vitest";
import { ForumError } from "../../src/forum/errors.js";
import { parseCommunityBlacklist, parseCommunityMembers } from "../../src/forum/parsers/community.js";
import { site } from "../../src/forum/site.js";
import { page } from "../helpers/fixtures.js";

// Фикстуры обезличены (scripts/anonymize-fixture.ts): ники PlayerN, id 9000000+.
describe("community members (/hmembers/)", () => {
  test("20 rows: nick, online server or offline, counters, dates; page count", () => {
    const list = parseCommunityMembers(page("community/members-253.html"), 253, 1);
    expect(list.community).toEqual({ id: 253, name: "Ивенты Minecraft Galaxy" });
    expect(list.totalPages).toBe(406);
    expect(list.members).toHaveLength(20);
    expect(list.members[0]).toEqual({
      user: { name: "Player001", id: 9000001, group: "vip" },
      topics: 0,
      posts: 0,
      joined: "2026-11-12 21:35:55",
    });
    // Игрок в игре: в колонке Online — название сервера.
    const online = list.members.filter((m) => m.online);
    expect(online).toHaveLength(1);
    expect(online[0].online).toBe("Dungeons");
  });

  test("unknown community: the forum's message", () => {
    expect(() => parseCommunityMembers(page("community/members-missing.html"), 999999, 1)).toThrow(ForumError);
    expect(() => parseCommunityMembers(page("community/members-missing.html"), 999999, 1)).toThrow(/не найдено/);
  });

  test("URL: 0-based page and sort parameter", () => {
    expect(site.communityMembers(391, 1)).toBe("/hmembers/391/0");
    expect(site.communityMembers(391, 3, 5)).toBe("/hmembers/391/2?f=5");
  });
});

describe("community blacklist (/hblacklist/)", () => {
  test("nick, reason, date; '(не указан)' is no reason", () => {
    const list = parseCommunityBlacklist(page("community/blacklist-391.html"), 391, 1);
    expect(list.community.name).toBe("Клуб гарантов");
    expect(list.totalPages).toBe(17);
    expect(list.entries).toHaveLength(20);
    expect(list.entries[0]).toEqual({
      user: { name: "Player001", id: 9000001, group: "vip" },
      reason: "Псевдогарант",
      added: "2025-11-08 20:28:03",
    });
    expect(list.entries.filter((e) => !e.reason)).toHaveLength(1);
  });
});
