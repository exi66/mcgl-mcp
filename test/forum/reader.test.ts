import { describe, expect, test } from "vitest";
import { ForumReader } from "../../src/forum/reader.js";
import { startFakeForum } from "../helpers/fake-forum.js";
import { syntheticTopic } from "../helpers/topic-html.js";

async function setup(total: number, forumPageSize: number, opts?: Parameters<typeof syntheticTopic>[2]) {
  const topic = syntheticTopic(total, forumPageSize, opts);
  const forum = await startFakeForum((req) => {
    const body = topic.handle(req.path);
    return body ? { body } : undefined;
  });
  const reader = new ForumReader(forum.http());
  const topicRequests = () => forum.requests.filter((r) => r.path.startsWith("/topic/")).map((r) => r.path);
  return { topic, forum, reader, topicRequests };
}

const numbers = (posts: { number?: number }[]) => posts.map((p) => p.number);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("ForumReader.topic: fixed-size pages over forum pagination", () => {
  test("forum shows all posts on one page: sliced into pages of 15", async () => {
    const { reader } = await setup(40, 100);

    const p1 = await reader.topic(1, 1);
    expect(p1).toMatchObject({ page: 1, pageSize: 15, totalPages: 3, totalPosts: 40 });
    expect(numbers(p1.posts)).toEqual(range(1, 15));

    expect(numbers((await reader.topic(1, 3)).posts)).toEqual(range(31, 40));
    await expect(reader.topic(1, 4)).rejects.toThrow(/only 3 page\(s\) of 15 posts \(40 posts\)/);
  });

  test("a page spanning two forum pages (forum shows 20 per page)", async () => {
    const { reader, topicRequests } = await setup(50, 20);
    const p2 = await reader.topic(1, 2);
    expect(p2).toMatchObject({ totalPages: 4, totalPosts: 50 });
    expect(numbers(p2.posts)).toEqual(range(16, 30));
    // Первая (размер страницы), последняя (сколько всего) и вторая (16..30 лежат на 1 и 2).
    expect(topicRequests().sort()).toEqual(["/topic/1/0", "/topic/1/1", "/topic/1/2"]);
  });

  test("custom pageSize", async () => {
    const { reader } = await setup(50, 20);
    const page = await reader.topic(1, 2, 7);
    expect(page).toMatchObject({ pageSize: 7, totalPages: 8 });
    expect(numbers(page.posts)).toEqual(range(8, 14));
  });

  test("forum pages are cached while the agent pages through a topic", async () => {
    const { reader, topicRequests } = await setup(50, 20);
    await reader.topic(1, 1);
    await reader.topic(1, 2);
    await reader.topic(1, 3);
    // Каждая страница форума скачана ровно один раз.
    expect(topicRequests().sort()).toEqual(["/topic/1/0", "/topic/1/1", "/topic/1/2"]);
  });

  test("deleted posts keep their place in the numbering", async () => {
    const { reader } = await setup(20, 100, { deleted: [3] });
    const p1 = await reader.topic(1, 1);
    expect(p1.posts[2]).toEqual({ deleted: true, number: 3, id: 1003 });
    expect(numbers(p1.posts)).toEqual(range(1, 15));
  });

  test("poll, notices and readers only on page 1", async () => {
    const { reader } = await setup(40, 100, { poll: true });
    const p1 = await reader.topic(1, 1);
    expect(p1.poll?.question).toBe("Q?");
    expect(p1.readers).toEqual(["Гость"]);
    const p2 = await reader.topic(1, 2);
    expect(p2.poll).toBeUndefined();
    expect(p2.readers).toBeUndefined();
  });

  test("player changes posts-per-page in forum settings: reader re-learns it", async () => {
    const { reader, topic } = await setup(50, 20);
    expect(numbers((await reader.topic(1, 1)).posts)).toEqual(range(1, 15));

    topic.setForumPageSize(10);
    // Запомненный размер (20) устарел: страница форума, скачанная заново, начинается
    // не с того номера — reader сбрасывает кеш и пересчитывает.
    expect(numbers((await reader.topic(1, 3)).posts)).toEqual(range(31, 45));
  });
});

describe("ForumReader.topic without page: newest posts", () => {
  test("single forum page: the last 15 posts", async () => {
    const { reader } = await setup(40, 100, { poll: true });
    const view = await reader.topic(1);
    expect(view).toMatchObject({ latest: true, totalPosts: 40, totalPages: 3 });
    expect(view.page).toBeUndefined();
    expect(numbers(view.posts)).toEqual(range(26, 40));
    // Агент открывает тему впервые: шапка тоже нужна.
    expect(view.poll?.question).toBe("Q?");
  });

  test("last forum page is short: tops up from the previous one", async () => {
    // 45 постов по 20: на последней странице форума только #41..#45.
    const { reader } = await setup(45, 20);
    expect(numbers((await reader.topic(1)).posts)).toEqual(range(31, 45));
  });

  test("short topic: everything there is", async () => {
    const { reader } = await setup(4, 20);
    expect(numbers((await reader.topic(1)).posts)).toEqual(range(1, 4));
  });

  test("topic seen in a list: goes straight to the last forum page (1 request)", async () => {
    const { reader, topicRequests } = await setup(100, 20);
    await reader.sectionTopics(4);
    const view = await reader.topic(1);
    expect(numbers(view.posts)).toEqual(range(86, 100));
    expect(topicRequests()).toEqual(["/topic/1/4"]);
  });

  test("topic grew to a new forum page since the list: falls back and still gets the newest", async () => {
    const { reader, topic, topicRequests } = await setup(100, 20);
    await reader.sectionTopics(4);
    topic.addPosts(3); // теперь 103 поста, 6 страниц форума
    const view = await reader.topic(1);
    expect(view.totalPosts).toBe(103);
    expect(numbers(view.posts)).toEqual(range(89, 103));
    expect(topicRequests()).toContain("/topic/1/5");
  });
});

describe("ForumReader.post", () => {
  test("adds the post number in the topic and the 15-post page it is on", async () => {
    const { reader } = await setup(50, 20);
    const view = await reader.post(1037);
    expect(view.post).toMatchObject({ id: 1037, number: 37 });
    expect(view.topic).toMatchObject({ id: 1, page: 3 });
  });
});
