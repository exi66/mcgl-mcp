import { describe, expect, test } from "vitest";
import { parseConversationList } from "../../src/forum/parsers/private.js";
import { parseTopicPage } from "../../src/forum/parsers/topic.js";
import { parsePostForm } from "../../src/forum/posting.js";
import { fixture, page } from "../helpers/fixtures.js";

// Фикстуры ЛС обезличены (scripts/anonymize-fixture.ts); тестовый аккаунт — Capri.
describe("private messages", () => {
  test("inbox: unread by me (yellow title), unread count from the header", () => {
    const list = parseConversationList(page("pm/inbox-unread.html"), 1);
    expect(list.unreadCount).toBe(1);
    const [fresh, system] = list.conversations;
    expect(fresh).toMatchObject({ id: 3729235, title: "тест", unread: true, unreadByOther: false, replies: 0 });
    expect(fresh.to?.name).toBe("Capri");
    expect(system).toMatchObject({ id: 3729233, unread: false, from: { name: "system", id: 4 } });
  });

  test("outbox: our message not read by the other side yet", () => {
    const list = parseConversationList(page("pm/outbox.html"), 1);
    expect(list.conversations[0]).toMatchObject({ id: 3729236, title: "Тест MCP", unread: false, unreadByOther: true });
    expect(list.conversations[0].from?.name).toBe("Capri");
  });

  test("a conversation reads like a topic; the reply form is the usual one", () => {
    const conv = parseTopicPage(page("pm/conversation-system.html"), 3729233, 1);
    expect(conv.title).toBe("Приглашение вступить в сообщество");
    expect(conv.posts[0]).toMatchObject({ number: 1, author: { name: "system" } });
    expect(parsePostForm(fixture("pm/conversation-system.html"))?.fields).toEqual({ form: "", addpost: "" });
  });
});
