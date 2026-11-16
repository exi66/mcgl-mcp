import { z } from "zod";
import { ForumError } from "../../../forum/errors.js";
import { definePublicTool, jsonResult } from "../../define-tool.js";

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

export const findUsers = definePublicTool({
  name: "forum_find_users",
  title: "Find players",
  description:
    "Players whose nick starts with the given text (case-insensitive): name, id, group. " +
    "group is the player's privilege (paid or staff role, e.g. vip, platinum, admin); 'girls' is only a nick color anyone can pick, not gender.",
  inputSchema: {
    prefix: z.string().trim().min(1).max(32).describe("Beginning of the nick"),
    limit: z.number().int().min(1).max(50).default(20),
  },
  annotations: readOnly,
  handler: async ({ prefix, limit }, { reader }) => jsonResult(await reader.findUsers(prefix, limit)),
});

export const userTopics = definePublicTool({
  name: "forum_user_topics",
  title: "Topics by player",
  description:
    "Topics created by a player, newest first, same row format as forum_list_topics. " +
    "Give nick (exact, case-insensitive) or userId. If the nick is unknown, the error lists similar nicks.",
  inputSchema: {
    nick: z.string().trim().min(1).max(32).optional(),
    userId: z.number().int().positive().optional(),
    page: z.number().int().positive().default(1).describe("1-based page number"),
  },
  annotations: readOnly,
  handler: async ({ nick, userId, page }, { reader }) => {
    if (!nick && !userId) throw new ForumError("Pass nick or userId");
    return jsonResult(await reader.userTopics({ id: userId, nick }, page));
  },
});

export const getScreenshot = definePublicTool({
  name: "forum_get_screenshot",
  title: "Screenshot",
  description:
    "A player's in-game screenshot by id (from forum_profile_section screenshots): title, author, section, rating, " +
    "full image url, and a page of comments (same post format as forum_get_topic).",
  inputSchema: {
    screenshotId: z.number().int().positive(),
    commentsPage: z.number().int().positive().default(1).describe("1-based page of comments"),
  },
  annotations: readOnly,
  handler: async ({ screenshotId, commentsPage }, { reader }) =>
    jsonResult(await reader.screenshot(screenshotId, commentsPage)),
});

export const listScreenshots = definePublicTool({
  name: "forum_list_screenshots",
  title: "Screenshot gallery",
  description:
    "The forum's screenshot gallery, 12 per page, newest first: id, title, author, rating, comment count, map position. " +
    "category: game (in-game screenshots), other (misc), works (players' works). filter: all, best (all time), " +
    "best_week, discussed, discussed_week. nick/userId: only one author's screenshots. Open one with forum_get_screenshot.",
  inputSchema: {
    category: z.enum(["game", "other", "works"]).default("game"),
    filter: z.enum(["all", "best", "best_week", "discussed", "discussed_week"]).default("all"),
    nick: z.string().trim().min(1).max(32).optional(),
    userId: z.number().int().positive().optional(),
    page: z.number().int().positive().default(1).describe("1-based page number"),
  },
  annotations: readOnly,
  handler: async ({ category, filter, nick, userId, page }, { reader }) =>
    jsonResult(
      await reader.screenshotGallery({
        category,
        filter,
        author: nick || userId ? { nick, id: userId } : undefined,
        page,
      }),
    ),
});

export const userTools = [findUsers, userTopics, getScreenshot, listScreenshots];
