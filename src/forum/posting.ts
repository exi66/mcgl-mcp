/**
 * Публикация от имени игрока: ответ в тему (обычную или сообщества) и новая
 * тема в разделе сообщества.
 *
 * Форум после поста какое-то время требует капчу: в форме появляется поле
 * `captcha` и таймер `setTimeout(…, <мс>)`, по которому оно исчезает
 * («Ввод капчи больше не требуется»). Капчу мы не проходим: пока она нужна,
 * пост не отправляется, агент получает ForumCaptchaError с временем ожидания.
 * (Сервер капчу может и не проверять — но это правило форума против ботов, и мы его соблюдаем.)
 *
 * Форум умеет молча отклонять пост (ответ 200 с той же формой, без ошибки —
 * например, у аккаунта мало времени в игре), поэтому успех проверяется только
 * по факту: новый пост появился в теме.
 */
import { ForumError } from "./errors.js";
import { load, text } from "./parsers/common.js";
import type { PlayerSession } from "./player-session.js";
import type { ForumReader, TopicKind } from "./reader.js";
import { site } from "./site.js";

/**
 * Форум молча обрезает текст поста/ЛС до 32768 байт (strlen в PHP — байты, а не символы:
 * кириллица в UTF-8 — 2 байта, то есть ~16 тыс. русских символов). Лучше отказать заранее.
 */
export const MAX_MESSAGE_BYTES = 32_768;

export function assertMessageSize(message: string): void {
  const bytes = Buffer.byteLength(message, "utf8");
  if (bytes > MAX_MESSAGE_BYTES) {
    throw new ForumError(
      `The message is too long for the forum: ${bytes} bytes in UTF-8, the limit is ${MAX_MESSAGE_BYTES} ` +
        "(about 16 000 Cyrillic characters). The forum would cut it silently; shorten it or split into several posts.",
    );
  }
}

export class ForumCaptchaError extends ForumError {
  constructor(readonly retryInSec: number) {
    super(
      `The forum requires a captcha for the next ${retryInSec}s (posting too often). ` +
        `Wait and try again, or post manually on the site.`,
    );
    this.name = "ForumCaptchaError";
  }
}

export interface PostForm {
  fields: Record<string, string>;
  /** Сколько ещё секунд форум требует капчу; undefined — не требует. */
  captchaForSec?: number;
}

/** Форма `#form-panel form`: скрытые поля и капча. Нет формы или поля текста — писать нельзя. */
export function parsePostForm(html: string): PostForm | undefined {
  const $ = load(html);
  const form = $("#form-panel form").first();
  if (!form.length || !form.find('textarea[name="text"]').length) return undefined;

  const fields: Record<string, string> = {};
  form.find('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr("name");
    if (name) fields[name] = $(el).attr("value") ?? "";
  });

  let captchaForSec: number | undefined;
  if (form.find('input[name="captcha"]').length) {
    // setTimeout(function(){ …'Ввод капчи больше не требуется'… }, 156000);
    const ms = /\},\s*(\d+)\s*\)/.exec(form.find("script").text())?.[1];
    captchaForSec = ms ? Math.ceil(Number(ms) / 1000) : 60;
  }
  return { fields, captchaForSec };
}

export class Poster {
  constructor(
    private readonly session: PlayerSession,
    private readonly reader: ForumReader,
  ) {}

  /** Ответ в тему. kind "hpost" — тема сообщества, "pm" — личная переписка. */
  async reply(kind: TopicKind, topicId: number, message: string) {
    assertMessageSize(message);
    const prefix = kind === "hpost" ? "hpost" : kind === "pm" ? "privatetopic" : "topic";
    const path = `/${prefix}/${topicId}/0`;
    const submit = `/${prefix}/${topicId}`;

    return this.session.withAuth(async () => {
      const form = this.formOrThrow((await this.session.getAuthed(path)).html, "this topic");
      const before = (await this.reader.topic(topicId, undefined, 1, kind, { fresh: true })).totalPosts;

      // Как jQuery $.post на сайте: тот же URL темы, Referer и X-Requested-With.
      const result = await this.session.http.postForm(
        submit,
        { ...form.fields, text: message },
        { referer: this.session.http.absoluteUrl(submit), "x-requested-with": "XMLHttpRequest" },
      );

      const after = await this.reader.topic(topicId, undefined, 1, kind, { fresh: true });
      const post = after.posts.at(-1);
      // Успех — в теме появился новый последний пост, и он от нас (а не чей-то одновременный).
      const mine =
        post !== undefined &&
        !post.deleted &&
        after.totalPosts > before &&
        (!this.session.nick || post.author.name === this.session.nick);
      if (!mine || post.deleted) {
        throw this.rejected(result.html);
      }
      return {
        topic: { id: topicId, title: after.title, community: after.community },
        post: { id: post.id, number: post.number },
        // Прямая ссылка на пост: /hmessage/ID у сообществ, /post/ID в общем форуме; у ЛС — на переписку.
        url: this.session.http.absoluteUrl(
          kind === "hpost" ? `/hmessage/${post.id}` : kind === "pm" ? submit : `/post/${post.id}`,
        ),
      };
    });
  }

  /** Новая тема в разделе сообщества. Успех — редирект на /hpost/<новая тема>. */
  async createCommunityTopic(sectionId: number, title: string, message: string) {
    assertMessageSize(message);
    const path = site.communitySection(sectionId, 1);
    const submit = `/htopic/${sectionId}`;

    return this.session.withAuth(async () => {
      const form = this.formOrThrow((await this.session.getAuthed(path)).html, "this section");
      const result = await this.session.http.postForm(
        submit,
        { ...form.fields, title, text: message },
        { referer: this.session.http.absoluteUrl(submit) },
      );

      const topicId = /\/hpost\/(\d+)/.exec(result.url)?.[1];
      if (!topicId) throw this.rejected(result.html);
      const topic = await this.reader.topic(Number(topicId), undefined, 1, "hpost", { fresh: true });
      return {
        topic: { id: Number(topicId), title: topic.title, community: topic.community, section: topic.section },
        url: this.session.http.absoluteUrl(`/hpost/${topicId}`),
      };
    });
  }

  /** Новое личное сообщение (новая переписка). Успех — редирект на /privatetopic/<новая>. */
  async sendPrivateMessage(nick: string, title: string, message: string) {
    assertMessageSize(message);
    const submit = site.privateNew();

    return this.session.withAuth(async () => {
      const form = this.formOrThrow((await this.session.getAuthed(submit)).html, "private messages");
      const result = await this.session.http.postForm(
        submit,
        { ...form.fields, user: nick, title, text: message },
        { referer: this.session.http.absoluteUrl(submit) },
      );

      const conversationId = /\/privatetopic\/(\d+)/.exec(result.url)?.[1];
      if (!conversationId) throw this.rejected(result.html);
      return {
        conversation: { id: Number(conversationId), title, to: nick },
        url: this.session.http.absoluteUrl(`/privatetopic/${conversationId}`),
      };
    });
  }

  private formOrThrow(html: string, where: string): PostForm & { fields: Record<string, string> } {
    const form = parsePostForm(html);
    if (!form) {
      throw new ForumError(`Cannot post in ${where}: it is closed or you have no rights to post here.`);
    }
    if (form.captchaForSec !== undefined) throw new ForumCaptchaError(form.captchaForSec);
    return form;
  }

  private rejected(html: string): ForumError {
    const $ = load(html);
    const reason = text($("table.alert td.caption").first().text()) || (/Введите[^<]*/.exec(html)?.[0] ?? "");
    return new ForumError(
      reason
        ? `The forum rejected the post: ${reason}`
        : "The forum did not accept the post and gave no reason. Possible causes: the account is too new " +
            "(little playtime), its e-mail is not confirmed, it is muted or blocked on the forum, the topic is closed, " +
            "or only VIP/Premium/moderators may reply there (the topic author always may).",
    );
  }
}
