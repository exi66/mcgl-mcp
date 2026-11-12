import { describe, expect, test } from "vitest";
import {
  ItemResolver,
  itemToken,
  legendToken,
  parseObjectLiteral,
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
