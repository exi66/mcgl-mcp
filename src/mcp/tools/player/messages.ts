import { z } from "zod";
import { Poster } from "../../../forum/posting.js";
import { DEFAULT_PAGE_SIZE, PM_FOLDERS } from "../../../forum/reader.js";
import { definePlayerTool, jsonResult } from "../../define-tool.js";

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const SEND =
  "Sends immediately on behalf of the player: show the user the recipient and exact text and get explicit " +
  "confirmation first. Write in Russian unless asked otherwise; bbCode is supported. After sending, the forum asks " +
  "for a captcha for a while; the tool does not solve captchas and returns how long to wait instead.";

export const listConversations = definePlayerTool({
  name: "forum_list_conversations",
  title: "Private messages",
  description:
    "The player's private conversations in a folder: id, title, from, to, replies, last message; " +
    "unread (not read by the player yet), unreadByOther (the other side has not read it yet), and unreadCount " +
    "(all unread conversations). " +
    "Folders: inbox, outbox, new (unread), system (forum notifications), favorites. Read one with forum_get_conversation.",
  inputSchema: {
    folder: z
      .enum(Object.keys(PM_FOLDERS) as [keyof typeof PM_FOLDERS, ...(keyof typeof PM_FOLDERS)[]])
      .default("inbox"),
    page: z.number().int().positive().default(1).describe("1-based page number"),
  },
  annotations: readOnly,
  handler: async ({ folder, page }, { reader }) => jsonResult(await reader.conversations(folder, page)),
});

export const getConversation = definePlayerTool({
  name: "forum_get_conversation",
  title: "Private conversation",
  description:
    "Messages of a private conversation, same format and paging as forum_get_topic: without page the newest " +
    "messages, page counts from the start. Opening a conversation marks it as read on the forum.",
  inputSchema: {
    conversationId: z.number().int().positive(),
    page: z.number().int().positive().optional().describe("1-based page from the start; omit for the newest"),
    pageSize: z.number().int().min(1).max(50).default(DEFAULT_PAGE_SIZE),
  },
  annotations: readOnly,
  handler: async ({ conversationId, page, pageSize }, { reader }) =>
    jsonResult(await reader.topic(conversationId, page, pageSize, "pm")),
});

export const sendMessage = definePlayerTool({
  name: "forum_send_message",
  title: "New private message",
  description: "Starts a new private conversation with a player (exact nick). " + SEND,
  inputSchema: {
    nick: z.string().trim().min(1).max(32).describe("Recipient's exact nick"),
    title: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(20000),
  },
  annotations: write,
  handler: async ({ nick, title, message }, { session, reader }) =>
    jsonResult(await new Poster(session, reader).sendPrivateMessage(nick, title, message)),
});

export const replyMessage = definePlayerTool({
  name: "forum_reply_message",
  title: "Reply in a private conversation",
  description: "Replies in an existing private conversation (id from forum_list_conversations). " + SEND,
  inputSchema: {
    conversationId: z.number().int().positive(),
    message: z.string().trim().min(1).max(20000),
  },
  annotations: write,
  handler: async ({ conversationId, message }, { session, reader }) =>
    jsonResult(await new Poster(session, reader).reply("pm", conversationId, message)),
});

export const messageTools = [listConversations, getConversation, sendMessage, replyMessage];
