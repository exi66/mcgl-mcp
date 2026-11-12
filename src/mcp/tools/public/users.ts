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

export const userTools = [findUsers, userTopics];
