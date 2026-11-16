import { z } from "zod";
import { Poster } from "../../../forum/posting.js";
import { definePlayerTool, jsonResult } from "../../define-tool.js";

// Публикация видна всем и сразу; отменить нельзя.
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const CONFIRM =
  "Publishes immediately and publicly on behalf of the player: show the user the exact final text and get " +
  "explicit confirmation first. Write in Russian unless the user asks otherwise; bbCode is supported " +
  "([b], [i], [u], [s], [quote=nick]..[/quote], [url=..]..[/url], [img]..[/img], [spoiler=..]..[/spoiler], [item]N[/item]). ";
const CAPTCHA =
  "After a post the forum asks for a captcha for a couple of minutes; the tool does not solve captchas and " +
  "returns how long to wait instead.";

const message = z.string().trim().min(1).max(20000).describe("Post text (bbCode allowed)");

export const createPost = definePlayerTool({
  name: "forum_create_post",
  title: "Reply in a topic",
  description:
    "Replies in a topic. inCommunity:true for community topics (rows with inCommunity / forum_community_topic). " +
    CONFIRM +
    "Fails if the topic is closed or the player may not post there. Returns the new post id, number and url. " +
    CAPTCHA,
  inputSchema: {
    topicId: z.number().int().positive(),
    inCommunity: z.boolean().default(false),
    message,
  },
  annotations: write,
  handler: async ({ topicId, inCommunity, message }, { session, reader }) =>
    jsonResult(await new Poster(session, reader).reply(inCommunity ? "hpost" : "topic", topicId, message)),
});

export const createCommunityTopic = definePlayerTool({
  name: "forum_create_community_topic",
  title: "New community topic",
  description:
    "Creates a topic in a community forum section (id from forum_community_sections). " +
    CONFIRM +
    "Returns the new topic id and url. " +
    CAPTCHA,
  inputSchema: {
    sectionId: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    message,
  },
  annotations: write,
  handler: async ({ sectionId, title, message }, { session, reader }) =>
    jsonResult(await new Poster(session, reader).createCommunityTopic(sectionId, title, message)),
});

export const postingTools = [createPost, createCommunityTopic];
