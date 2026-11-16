import { describe, expect, test } from "vitest";
import { ForumError } from "../../src/forum/errors.js";
import { navigation, load } from "../../src/forum/parsers/common.js";
import {
  actionLink,
  parseCommunity,
  parseCommunityForum,
  parseCommunityList,
  parseMyCommunities,
} from "../../src/forum/parsers/community.js";
import { parseTopicList } from "../../src/forum/parsers/topic-list.js";
import { communityFromNav, parseTopicPage } from "../../src/forum/parsers/topic.js";
import { page } from "../helpers/fixtures.js";

describe("community list (/teams/)", () => {
  test("rows with rating, leader, members and open flag; known page count", () => {
    const list = parseCommunityList(page("community-list.html"), 1);
    expect(list.communities).toHaveLength(20);
    expect(list.totalPages).toBeGreaterThan(30);
    expect(list.hasMore).toBe(true);
    expect(list.communities[0]).toMatchObject({
      id: 98,
      name: "Торговый сектор",
      place: 1,
      leader: { name: "XBocT", id: 20304 },
      open: true,
    });
    expect(list.communities[0].members).toBeGreaterThan(1000);
    // Есть и открытые, и закрытые.
    expect(new Set(list.communities.map((c) => c.open))).toEqual(new Set([true, false]));
  });

  test("search by title: substring, case-insensitive; no page links", () => {
    const list = parseCommunityList(page("community-search-torg.html"), 1);
    const names = list.communities.map((c) => c.name);
    expect(names).toContain("Торговый сектор");
    expect(names.every((n) => /торг/i.test(n))).toBe(true);
    expect(list.totalPages).toBeUndefined();
    expect(list.hasMore).toBe(false);
  });
});

describe("community main page (/hmain/N)", () => {
  test("header and description; guest has no membership state", () => {
    const c = parseCommunity(page("community-253-guest.html"), 253);
    expect(c).toMatchObject({ id: 253, name: "Ивенты Minecraft Galaxy", leader: { name: "GalaxyEvent" } });
    expect(c.members).toBeGreaterThan(1000);
    expect(c.place).toBeGreaterThan(0);
    expect(c.membership).toBeUndefined();
    expect(c.description).toMatch(/Что такое ивенты\?/);
  });

  test.each([
    ["community-253-can-join.html", 253, "can_join"],
    ["community-253-member.html", 253, "member"],
    ["community-98-blocked.html", 98, "blocked"],
    ["community-1-closed.html", 1, "closed"],
  ] as const)("%s → %s", (file, id, membership) => {
    expect(parseCommunity(page(file), id).membership).toBe(membership);
  });

  test("blocked: the forum's reason", () => {
    expect(parseCommunity(page("community-98-blocked.html"), 98).joinBlockedReason).toMatch(/время игры ниже/);
  });

  test("join/leave links carry a token", () => {
    expect(actionLink(page("community-253-can-join.html"), "join")).toMatch(/^\/hmain\/253\/join\?_h=/);
    expect(actionLink(page("community-253-member.html"), "leave")).toMatch(/^\/hmain\/253\/leave\?_h=/);
    expect(actionLink(page("community-253-member.html"), "join")).toBeUndefined();
  });
});

describe("community forum (/hforum/N)", () => {
  test("guest: login required", () => {
    expect(() => parseCommunityForum(page("community-forum-253-guest.html"), 253)).toThrow(ForumError);
    expect(() => parseCommunityForum(page("community-forum-253-guest.html"), 253)).toThrow(/авторизоваться/);
  });

  test("non-member sees only 'Общие форумы'; member also private sections", () => {
    const outsider = parseCommunityForum(page("community-forum-253.html"), 253);
    const member = parseCommunityForum(page("community-forum-253-member.html"), 253);
    expect(member.community).toEqual({ id: 253, title: "Ивенты Minecraft Galaxy" });
    expect(outsider.sections.every((s) => s.category === "Общие форумы" && !s.membersOnly)).toBe(true);
    expect(member.sections.length).toBeGreaterThan(outsider.sections.length);
    const priv = member.sections.filter((s) => s.membersOnly);
    expect(priv.map((s) => s.category)).toContain("Приватные форумы");
    expect(priv.map((s) => s.id)).toContain(450);
    expect(outsider.sections[0]).toMatchObject({ id: 449, title: "Творческие конкурсы" });
  });

  test("'Только чтение' is members-only too", () => {
    const forum = parseCommunityForum(page("community-forum-98.html"), 98);
    expect(forum.sections.find((s) => s.id === 330)).toMatchObject({ category: "Только чтение", membersOnly: true });
    expect(forum.sections.find((s) => s.id === 191)).toMatchObject({ category: "Общие форумы", membersOnly: false });
  });
});

describe("community sections and topics", () => {
  test("section topics are community topics; breadcrumbs give the community", () => {
    const p = page("community-section-449.html");
    const list = parseTopicList(p, 1, ["hpost"]);
    expect(list.title).toBe("Творческие конкурсы");
    expect(list.topics.length).toBeGreaterThan(0);
    expect(list.topics.every((t) => t.inCommunity)).toBe(true);
    const $ = load(p.html);
    expect(communityFromNav($, navigation($).nav)).toEqual({ id: 253, title: "Ивенты Minecraft Galaxy" });
  });

  test("members-only section for an outsider: the forum's error", () => {
    expect(() => parseTopicList(page("community-section-330-denied.html"), 1, ["hpost"])).toThrow(/нет прав/);
  });

  test("community topic: posts, section and community", () => {
    const topic = parseTopicPage(page("community-topic-103678.html"), 103678, 1);
    expect(topic.community).toEqual({ id: 253, title: "Ивенты Minecraft Galaxy" });
    expect(topic.section).toMatchObject({ id: 450, title: "Итоги ивентов" });
    expect(topic.posts.length).toBeGreaterThan(0);
    expect(topic.posts[0]).toMatchObject({ number: 1, id: 855786 });
  });
});

describe("my communities", () => {
  test("profile block", () => {
    expect(parseMyCommunities(page("profile-member.html"))).toEqual([{ id: 253, name: "Ивенты Minecraft Galaxy" }]);
    expect(parseMyCommunities(page("profile-no-communities.html"))).toEqual([]);
  });

  test("/teamforums/: community topics with the section id from the icon", () => {
    const list = parseTopicList(page("my-community-topics.html"), 1, ["hpost"]);
    expect(list.topics.length).toBeGreaterThan(10);
    expect(list.topics.every((t) => t.inCommunity && typeof t.sectionId === "number")).toBe(true);
  });

  test("/forum/0 for a member: community topics carry the community name, not a reply restriction", () => {
    const list = parseTopicList(page("latest-member.html"), 1, ["topic", "hpost"]);
    const community = list.topics.filter((t) => t.inCommunity);
    const regular = list.topics.filter((t) => !t.inCommunity);
    expect(community.length).toBeGreaterThan(0);
    expect(community.length).toBeLessThanOrEqual(10);
    expect(regular.length).toBeGreaterThan(0);
    expect(community.every((t) => t.community === "Ивенты Minecraft Galaxy")).toBe(true);
    expect(community.every((t) => ["all", "vip", "premium_platinum", "moderators"].includes(t.whoCanReply))).toBe(true);
    expect(regular.every((t) => t.section && !t.community)).toBe(true);
  });
});
