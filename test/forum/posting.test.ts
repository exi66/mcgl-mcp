import { describe, expect, test } from "vitest";
import { ForumError } from "../../src/forum/errors.js";
import { PlayerSession } from "../../src/forum/player-session.js";
import { ForumCaptchaError, Poster, parsePostForm } from "../../src/forum/posting.js";
import { ForumReader } from "../../src/forum/reader.js";
import type { FakeRequest } from "../helpers/fake-forum.js";
import { fixture } from "../helpers/fixtures.js";
import { startLoginForum } from "../helpers/login-forum.js";
import { topicHtml, type SynthPost } from "../helpers/topic-html.js";

describe("parsePostForm", () => {
  test("reply form with a captcha: hidden fields and how long the captcha is required", () => {
    const form = parsePostForm(fixture("posting/topic-captcha.html"));
    expect(form?.fields).toEqual({ form: "", addpost: "" });
    expect(form?.captchaForSec).toBe(156);
  });

  test("new topic form in a community section, also with a captcha", () => {
    const form = parsePostForm(fixture("posting/section-captcha.html"));
    expect(form?.fields).toEqual({ form: "", addtopic: "" });
    expect(form?.captchaForSec).toBeGreaterThan(100);
  });

  test("form without a captcha; page without a form", () => {
    expect(parsePostForm(fixture("topic-134087.html"))).toEqual({ fields: { form: "", addpost: "" } });
    expect(parsePostForm(fixture("main.html"))).toBeUndefined();
  });
});

const FORM = `<div class="form-panel" id="form-panel"><form action="" method="post">
  <input type="hidden" name="form"/><input type="hidden" name="addpost" value=""/><textarea name="text"></textarea></form></div>`;
const CAPTCHA_FORM = FORM.replace(
  "</textarea>",
  `</textarea><input id="captcha" type="text" name="captcha"/><script>setTimeout(function(){ x(); }, 90000);</script>`,
);

/**
 * Фейковая тема сообщества /hpost/7 поверх настоящего потока логина.
 * mode: ok — пост добавляется и редирект на тему; silent — форум молча отдаёт форму;
 * captcha — в форме капча; closed — формы нет.
 */
async function setup(mode: "ok" | "silent" | "captcha" | "closed") {
  const posts: SynthPost[] = [{ number: 1, id: 101, author: "Someone", text: "first" }];
  const sent: FakeRequest[] = [];
  const page = () => {
    const html = topicHtml({ posts, page: 1, totalPages: 1 }).replace(
      "</body>",
      `${mode === "closed" ? "" : mode === "captcha" ? CAPTCHA_FORM : FORM}</body>`,
    );
    // Залогиненная страница: без кнопки «Войти».
    return html.replace('<a class="button" href="/guilogin/">Войти</a>', "");
  };
  const forum = await startLoginForum({
    extra: (req) => {
      if (req.method === "GET" && /^\/hpost\/7(\/0)?$/.test(req.path)) return { body: page() };
      if (req.method === "POST" && req.path === "/hpost/7") {
        sent.push(req);
        if (mode === "silent") return { body: page() };
        posts.push({ number: posts.length + 1, id: 100 + posts.length + 1, author: "Capri", text: req.form.text });
        return { status: 302, headers: { location: "/hpost/7/0" } };
      }
    },
  });
  const http = forum.http();
  const session = new PlayerSession(http, { login: "Capri", password: "secret" });
  await session.whoami();
  return { poster: new Poster(session, new ForumReader(http, session)), sent };
}

describe("Poster.reply", () => {
  test("posts like the site does and confirms the new post is ours", async () => {
    const { poster, sent } = await setup("ok");
    const result = await poster.reply("hpost", 7, "Привет [b]всем[/b]");
    expect(result.post).toEqual({ id: 102, number: 2 });
    expect(result.url).toMatch(/\/hmessage\/102$/);
    expect(sent).toHaveLength(1);
    expect(sent[0].form).toEqual({ form: "", addpost: "", text: "Привет [b]всем[/b]" });
    expect(sent[0].headers["x-requested-with"]).toBe("XMLHttpRequest");
    expect(sent[0].headers.referer).toMatch(/\/hpost\/7$/);
  });

  test("captcha required: nothing is sent, the error says how long to wait", async () => {
    const { poster, sent } = await setup("captcha");
    const error = await poster.reply("hpost", 7, "text").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForumCaptchaError);
    expect((error as ForumCaptchaError).retryInSec).toBe(90);
    expect(sent).toHaveLength(0);
  });

  test("forum silently ignores the post: error, not a fake success", async () => {
    const { poster, sent } = await setup("silent");
    await expect(poster.reply("hpost", 7, "text")).rejects.toThrow(/did not accept the post/);
    expect(sent).toHaveLength(1); // и ровно одна попытка: POST не повторяется
  });

  test("no form (closed topic, no rights): error, nothing sent", async () => {
    const { poster, sent } = await setup("closed");
    await expect(poster.reply("hpost", 7, "text")).rejects.toThrow(ForumError);
    await expect(poster.reply("hpost", 7, "text")).rejects.toThrow(/closed or you have no rights/);
    expect(sent).toHaveLength(0);
  });
});

describe("Poster.createCommunityTopic", () => {
  test("success is the redirect to the new topic", async () => {
    const created: FakeRequest[] = [];
    const forum = await startLoginForum({
      extra: (req) => {
        const form = FORM.replace('name="addpost"', 'name="addtopic"');
        if (req.method === "GET" && req.path === "/htopic/5/0") return { body: `<html><body>${form}</body></html>` };
        if (req.method === "POST" && req.path === "/htopic/5") {
          created.push(req);
          return { status: 302, headers: { location: "/hpost/9" } };
        }
        if (req.path === "/hpost/9/0") {
          return {
            body: topicHtml({
              title: "Новая тема",
              posts: [{ number: 1, id: 900, author: "Capri" }],
              page: 1,
              totalPages: 1,
            }).replace('<a class="button" href="/guilogin/">Войти</a>', ""),
          };
        }
      },
    });
    const http = forum.http();
    const session = new PlayerSession(http, { login: "Capri", password: "secret" });
    const result = await new Poster(session, new ForumReader(http, session)).createCommunityTopic(
      5,
      "Новая тема",
      "Текст",
    );
    expect(result.topic).toMatchObject({ id: 9, title: "Новая тема" });
    expect(created[0].form).toEqual({ form: "", addtopic: "", title: "Новая тема", text: "Текст" });
  });
});
