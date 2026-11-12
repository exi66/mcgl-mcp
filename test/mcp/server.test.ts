import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { ForumReader } from "../../src/forum/reader.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { startFakeForum } from "../helpers/fake-forum.js";
import { fixture } from "../helpers/fixtures.js";

/** Путь на форуме → фикстура. */
const PAGES: Record<string, string> = {
  "/main/": "main.html",
  "/forum/0/0": "latest.html",
  "/forum/4/0": "section-4.html",
  "/forum/9/0": "section-missing.html",
  "/topic/134087/0": "topic-134087.html",
  "/post/2120899": "post-2120899.html",
};

async function connect() {
  const forum = await startFakeForum((req) => (PAGES[req.path] ? { body: fixture(PAGES[req.path]) } : undefined));
  const server = createMcpServer({ reader: new ForumReader(forum.http()) });
  const client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, forum };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = result.content[0]?.text ?? "";
  return { text, isError: result.isError ?? false, json: () => JSON.parse(text) };
}

describe("MCP server", () => {
  test("advertises read tools, instructions and package version", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "forum_get_post",
      "forum_get_topic",
      "forum_latest_topics",
      "forum_list_sections",
      "forum_list_topics",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    // Описания на английском (экономия токенов).
    expect(JSON.stringify(tools)).not.toMatch(/[а-яё]/i);

    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(client.getServerVersion()).toEqual({ name: "mcgl-mcp", version: pkg.version });
    expect(client.getInstructions()).toMatch(/Russian/);
  });

  test("returns compact JSON without false flags", async () => {
    const { client } = await connect();
    const { text, json } = await call(client, "forum_list_topics", { sectionId: 4 });
    expect(text).not.toMatch(/\n/);
    expect(text).not.toMatch(/:false/);
    expect(json().topics.length).toBeGreaterThan(0);
  });

  test("calls go to the right forum pages (pages are 0-based in URLs)", async () => {
    const { client, forum } = await connect();
    await call(client, "forum_list_sections");
    await call(client, "forum_latest_topics");
    await call(client, "forum_get_topic", { topicId: 134087 });
    await call(client, "forum_get_post", { postId: 2120899 });
    expect(forum.requests.map((r) => r.path)).toEqual(["/main/", "/forum/0/0", "/topic/134087/0", "/post/2120899"]);
  });

  test("forum errors come back as tool errors, not protocol errors", async () => {
    const { client } = await connect();
    const missing = await call(client, "forum_list_topics", { sectionId: 9 });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/не найден/);

    const unreachable = await call(client, "forum_get_topic", { topicId: 1 });
    expect(unreachable.isError).toBe(true);
  });

  test("rejects invalid arguments", async () => {
    const { client } = await connect();
    const result = await call(client, "forum_list_topics", { sectionId: 42 });
    expect(result.isError).toBe(true);
  });
});
