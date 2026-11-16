import { describe, expect, test } from "vitest";
import {
  ItemResolver,
  itemToken,
  legendToken,
  parseClanCard,
  parseCommunityCard,
  parseObjectItems,
  parseObjectLiteral,
  parsePlayerCard,
  parseUserExact,
  parseUserPrefix,
} from "../../src/forum/objects.js";
import { startFakeForum } from "../helpers/fake-forum.js";
import { fixture } from "../helpers/fixtures.js";

describe("parseObjectLiteral", () => {
  test("parses real tooltip responses", () => {
    expect(parseObjectLiteral(fixture("object-item-41.txt"))).toEqual({
      _type: "2",
      id: "41",
      title: "Золотой блок",
      info: expect.any(String),
    });
    expect(parseObjectLiteral(fixture("object-item-35-14.txt"))?.title).toBe("Красная шерсть");
    expect(parseObjectLiteral(fixture("object-item-missing.txt"))).toBeUndefined();
  });

  test("handles escaped quotes", () => {
    expect(parseObjectLiteral(String.raw`{'title':'It\'s "ok"','info':''}`)).toEqual({ title: `It's "ok"`, info: "" });
  });
});

describe("ItemResolver", () => {
  const items: Record<string, string> = {
    "/object/41/2": "{'_type':'2','id':'41','title':'Золотой блок','info':'x'}",
    "/object/35/2?d=14": "{'_type':'2','id':'35','title':'Красная шерсть','info':'x'}",
    "/object/1/2": "{'_type':'2','id':'1','title':'Камень','info':'x'}",
    "/object/124/2": "{'_type':'2','id':'124','title':'Ажурный камень','info':'x'}",
  };
  const fakeItems = () => startFakeForum((req) => ({ body: items[req.path] ?? "" }));

  test("replaces item tokens and craft legends with names", async () => {
    const forum = await fakeItems();
    const resolver = new ItemResolver(forum.http());
    const [text] = await resolver.resolve([
      `${itemToken(41, 0)}, ${itemToken(35, 14)}, ${itemToken(999, 0)}\n${legendToken([
        [1, 0],
        [124, 0],
      ])}`,
    ]);
    expect(text).toBe("[Золотой блок #41], [Красная шерсть #35:14], [item #999]\n1 = Камень\n124 = Ажурный камень");
  });

  test("caches lookups across calls and dedupes within a call", async () => {
    const forum = await fakeItems();
    const resolver = new ItemResolver(forum.http());
    await resolver.resolve([itemToken(41, 0), itemToken(41, 0)]);
    await resolver.resolve([itemToken(41, 0)]);
    expect(forum.requests).toHaveLength(1);
  });

  test("limits new lookups per call; the rest resolve on later calls", async () => {
    const forum = await fakeItems();
    const resolver = new ItemResolver(forum.http(), 1);
    const text = `${itemToken(41, 0)} ${itemToken(1, 0)}`;

    expect((await resolver.resolve([text]))[0]).toBe("[Золотой блок #41] [item #1]");
    expect((await resolver.resolve([text]))[0]).toBe("[Золотой блок #41] [Камень #1]");
    expect(forum.requests).toHaveLength(2);
  });
});

describe("player lookup responses", () => {
  test("exact nick → id; unknown nick → undefined (forum answers player$0)", () => {
    expect(parseUserExact(fixture("user-exact-xbost.txt"))).toEqual({ id: 20304, name: "XBocT" });
    expect(parseUserExact(fixture("user-exact-missing.txt"))).toBeUndefined();
    expect(parseUserExact("")).toBeUndefined();
  });

  test("nick prefix → players, without empty rows and deleted accounts", () => {
    const users = parseUserPrefix(fixture("user-prefix-xbo.txt"));
    expect(users[0]).toEqual({ id: 20304, name: "XBocT", group: "platinum" });
    expect(users.every((u) => u.name && u.id > 0 && !u.name.startsWith("player$"))).toBe(true);
    expect(parseUserPrefix("")).toEqual([]);
  });
});

// Ответы /object/ в настоящем формате (pages/object.php), игроки и кланы — публичные данные.
describe("object cards", () => {
  test("player card: profession by number, counters as numbers, empty registration omitted", () => {
    const raw =
      "{'_type':'1','id':'1','login':'admin','avatar':'1','register':'','last_login':'2026-10-03','make':'304207'," +
      "'crush':'358402','rating':'2547','prof':'2','posts':'4613','bans':'0','bansall':'1'}";
    expect(parsePlayerCard(raw)).toEqual({
      id: 1,
      name: "admin",
      lastLogin: "2026-10-03",
      profession: "Кузнец",
      blocksPlaced: 304207,
      blocksBroken: 358402,
      forumRating: 2547,
      forumPosts: 4613,
      activeBans: 0,
      bansTotal: 1,
    });
    expect(parsePlayerCard("{'_type':'1','id':'5','login':'x','prof':'0'}")?.profession).toBeUndefined();
    expect(parsePlayerCard("")).toBeUndefined();
  });

  test("clan card; unknown clan is an empty response", () => {
    const raw =
      "{'_type':'10','id':'2369','name':'OXPAHA','leader':'-RIZI-','members':'106','place':'16','wars':'12'," +
      "'unions':'14','level':'1','icon':''}";
    expect(parseClanCard(raw)).toEqual({
      id: 2369,
      name: "OXPAHA",
      leader: "-RIZI-",
      members: 106,
      place: 16,
      wars: 12,
      unions: 14,
      level: 1,
    });
    expect(parseClanCard("\n")).toBeUndefined();
  });

  test("community summary: public = open recruitment", () => {
    const raw =
      "{'_type':'3','id':'253','name':'Ивенты','leader':'GalaxyEvent','time':'2012-10-28 13:33:05'," +
      "'topics':'692','posts':'31046','public':'1','icon':'1'}";
    expect(parseCommunityCard(raw)).toEqual({ created: "2012-10-28 13:33:05", topics: 692, posts: 31046, open: true });
    expect(parseCommunityCard(raw.replace("'public':'1'", "'public':'0'"))?.open).toBe(false);
  });

  test("staff lists: items of the nested array", () => {
    const raw =
      "{'_type':7, 'items':[{'id':'625349','login':'Xenogen','group':'mods'},{'id':'1','login':'admin','group':'admins'}]}";
    expect(parseObjectItems(raw)).toEqual([
      { id: "625349", login: "Xenogen", group: "mods" },
      { id: "1", login: "admin", group: "admins" },
    ]);
    expect(parseObjectItems("{'_type':8, 'items':[]}")).toEqual([]);
  });
});
