import { describe, expect, test } from "vitest";
import { ForumError } from "../../src/forum/errors.js";
import {
  parseProfile,
  parseProfileSection,
  parseZoneInfo,
  parseZoneResidents,
} from "../../src/forum/parsers/profile.js";
import type { ProfileSectionName } from "../../src/forum/types.js";
import { page } from "../helpers/fixtures.js";

// Фикстуры профилей обезличены (scripts/anonymize-fixture.ts): игроки — PlayerNNN, id — 9000000+.
const fx = (name: string) => page(`profile/${name}.html`);
const section = (name: string, s: ProfileSectionName) => parseProfileSection(fx(name), s);

describe("profile main page", () => {
  test("blocks: groups, info, game stats, activity, clan, communities", () => {
    const p = parseProfile(fx("ge-profilemain"), 618942);
    expect(p).toMatchObject({ id: 618942, name: "GalaxyEvent", groups: ["vip", "eventmoder"] });
    expect(p.info["Регистрация"]).toMatch(/^\d{4}-\d\d-\d\d/);
    expect(p.info).not.toHaveProperty("Логин");
    expect(Object.keys(p.game)).toEqual(expect.arrayContaining(["Профессия", "Время игры"]));
    expect(p.activity).toHaveProperty("Статус на форуме");
    expect(Array.isArray(p.communities)).toBe(true);
  });

  test("communities block of the test account", () => {
    expect(parseProfile(page("profile-member.html"), 714940).communities).toEqual([
      { id: 253, name: "Ивенты Minecraft Galaxy" },
    ]);
    expect(parseProfile(page("profile-no-communities.html"), 714940).communities).toEqual([]);
  });
});

describe("profile sections", () => {
  test("bans: three tables; ban requests with decision", () => {
    const { data } = section("userbans", "bans") as { data: { bans: unknown[]; mutes: unknown[]; banRequests: any[] } };
    expect(data.bans).toEqual([]);
    expect(data.mutes).toEqual([]);
    expect(data.banRequests.length).toBeGreaterThan(5);
    expect(data.banRequests[0]).toMatchObject({ id: 111397, violation: "Твинк", status: "отклонена" });
    expect(data.banRequests[0].decidedBy.name).toMatch(/^Player\d+$/);
  });

  test("freezes and warnings", () => {
    const freezes = section("freeze", "freezes").data as any[];
    expect(freezes).toHaveLength(2);
    expect(freezes[0]).toMatchObject({ days: "1", status: "закрыта" });
    const warnings = section("warnlog", "warnings").data as any[];
    expect(warnings[0]).toMatchObject({ postId: 1118517 });
    expect(warnings[0].rule).toMatch(/^2\.1\.4\./);
  });

  test("karma totals", () => {
    expect(section("ge-userkarma", "karma").data).toEqual({ plus: 54, minus: -68, total: -14 });
  });

  test("votes: only the table's own rows; comment and a short post excerpt", () => {
    const { totalPages, data } = section("ge-uservotes", "votes") as { totalPages: number; data: any[] };
    expect(totalPages).toBe(12);
    expect(data).toHaveLength(20);
    expect(data[0]).toMatchObject({
      vote: "+",
      topic: { id: 126704, title: "Ивент Лабиринт" },
      comment: "Выглядит круто",
    });
    expect(data.every((v) => v.vote === "+" || v.vote === "-")).toBe(true);
    expect(data.every((v) => !v.post || v.post.length <= 161)).toBe(true);
  });

  test("friends, logins, achievements, screenshots", () => {
    expect(section("ge-followers", "friends").data).toEqual([
      expect.objectContaining({ confirmed: true, online: "offline" }),
      expect.anything(),
    ]);
    const games = section("ge-gameloginsnew", "game_logins");
    expect(games.totalPages).toBe(2);
    expect((games.data as any[])[0]).toEqual(
      expect.objectContaining({ server: "MapCreator", ownHardware: true, duration: "0ч 10м 7с" }),
    );
    // IP и железо — только в своём профиле, их не отдаём.
    expect(JSON.stringify(games.data)).not.toMatch(/"ip"|"computer"/i);
    expect(section("ge-forumlogins", "forum_logins").totalPages).toBe(5);
    const ach = section("ge-userachieve", "achievements").data as any[];
    expect(ach[0]).toMatchObject({ title: "Крушитель", description: "Разрушить любые блоки", progress: "42/10 000" });
    expect((section("ge-userscreens", "screenshots").data as any[])[0]).toMatchObject({
      id: 149215,
      server: "Olympic",
      rating: 0,
      position: "237,-46",
    });
  });

  test("zones: grouped by server; hidden zones have no position", () => {
    const zones = section("ge-zones", "zones").data as any[];
    expect(zones[0]).toMatchObject({ id: 2312280, server: "Olympic", type: "Город", position: "0,-301" });
    const hidden = (section("zones-hidden", "zones").data as any[]).filter((z) => z.hidden);
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((z) => z.position === undefined && z.size === undefined)).toBe(true);
  });

  test("closed section (images of another player): the forum's message", () => {
    expect(() => parseProfileSection(fx("userimages-closed"), "screenshots")).toThrow(ForumError);
    expect(() => parseProfileSection(fx("userimages-closed"), "screenshots")).toThrow(/Доступ к разделу закрыт/);
  });
});

describe("zone details", () => {
  test("owner, place, size and residents", () => {
    const zone = parseZoneInfo(fx("zoneinfo"), 2201861);
    expect(zone).toMatchObject({
      name: "Idol of Pride",
      server: "Hunter",
      position: "1159,-2633",
      coordinates: "1159, 64, -2633",
      size: "76, 64, 76",
    });
    expect(zone.owner?.name).toMatch(/^Player\d+$/);
    const residents = parseZoneResidents(fx("zonebuilders"));
    expect(residents).toHaveLength(6);
    expect(residents?.[0].registeredAt).toMatch(/^\d{4}-/);
  });

  test("hidden zone: no owner, position or residents", () => {
    const zone = parseZoneInfo(fx("zoneinfo-hidden"), 2880838);
    expect(zone).toMatchObject({ hidden: true, server: "Guest" });
    expect(zone.owner).toBeUndefined();
    expect(parseZoneResidents(fx("zonebuilders-hidden"))).toBeUndefined();
  });
});

describe("screenshot", () => {
  test("card: title, author, section, rating, full image", async () => {
    const { parseScreenshot } = await import("../../src/forum/parsers/screenshot.js");
    expect(parseScreenshot(fx("screeninfo"), 149215)).toEqual({
      id: 149215,
      title: "sr",
      author: { name: "GalaxyEvent", id: 618942, group: "eventmoder" },
      section: "Игровые",
      rating: 0,
      image: "https://forum.minecraft-galaxy.ru/png/GalaxyEvent/sr.jpg",
    });
  });

  test("comments use the post format", async () => {
    const { parseScreenshotComments } = await import("../../src/forum/parsers/screenshot.js");
    const { totalPages, comments } = parseScreenshotComments(fx("screencomments"), 1);
    expect(totalPages).toBe(1);
    expect(comments.length).toBeGreaterThan(10);
    expect(comments[0]).toMatchObject({ number: 1, id: 117595, text: "This is Noir Villar!" });
  });
});

describe("screenshot gallery", () => {
  test("tiles: id from show_screen(), title, author, rating, comments, position; page count", async () => {
    const { parseScreenshotGallery } = await import("../../src/forum/parsers/screenshot.js");
    const g = parseScreenshotGallery(fx("screens-gallery"), 1);
    expect(g.totalPages).toBeGreaterThan(1000);
    expect(g.screenshots).toHaveLength(12);
    expect(g.screenshots[0]).toMatchObject({ id: 191694, title: "Mob", rating: 7, comments: 3, position: "116,120" });
    expect(g.screenshots[0].author?.name).toMatch(/^Player\d+$/);
  });
});

test("gallery 'works'/'other': tiles open via show_custom_screen, id still found", async () => {
  const { parseScreenshotGallery } = await import("../../src/forum/parsers/screenshot.js");
  const g = parseScreenshotGallery(fx("screens-works"), 1);
  expect(g.screenshots).toHaveLength(12);
  expect(g.screenshots[0]).toMatchObject({ id: 191033, title: "МайклМайерс", comments: 0 });
  expect(g.screenshots[0].position).toBeUndefined();
});
