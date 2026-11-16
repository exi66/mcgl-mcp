import { z } from "zod";
import { PROFILE_SECTIONS } from "../../../forum/types.js";
import { definePlayerTool, jsonResult } from "../../define-tool.js";

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

// Игрок: ник или id; без них — сам залогиненный игрок.
const user = {
  nick: z.string().trim().min(1).max(32).optional().describe("Exact nick (case-insensitive)"),
  userId: z.number().int().positive().optional(),
};

export const getProfile = definePlayerTool({
  name: "forum_get_profile",
  title: "Player profile",
  description:
    "A player's profile (yours if no nick/userId): groups (privileges; 'girls' is only a nick color, not gender), " +
    "info (registration, last login, posts, topics…), game stats (profession, race, playtime, top place…), " +
    "activity (online status), resources, clan with squad, communities the player is in. Field labels are in Russian.",
  inputSchema: user,
  annotations: readOnly,
  handler: async ({ nick, userId }, { reader }) => jsonResult(await reader.profile({ nick, id: userId })),
});

export const profileSection = definePlayerTool({
  name: "forum_profile_section",
  title: "Player profile section",
  description:
    "One section of a player's profile (yours if no nick/userId), paged. Sections: " +
    "bans (game bans, chat mutes, ban requests against the player); freezes (account freezes: by whom, when, days, status); " +
    "warnings (forum moderator warnings: rule, post id, time); karma (plus/minus/total set by players); " +
    "votes (likes '+' / dislikes '-' other players gave to this player's posts, with comment and post excerpt); " +
    "friends (nick, confirmed, online, added); game_logins (server sessions; ownHardware false means a guest login " +
    "by someone the owner gave guest access to); forum_logins (success, time, error); achievements (title, progress, type); " +
    "screenshots (title, rating, server, position); zones (land claims: type, name, residents, server, position, size; " +
    "hidden:true when the owner bought hiding - no position). Boolean flags appear only when true.",
  inputSchema: {
    ...user,
    section: z.enum(PROFILE_SECTIONS),
    page: z.number().int().positive().default(1).describe("1-based page number"),
  },
  annotations: readOnly,
  handler: async ({ nick, userId, section, page }, { reader }) =>
    jsonResult(await reader.profileSection({ nick, id: userId }, section, page)),
});

export const zoneInfo = definePlayerTool({
  name: "forum_zone_info",
  title: "Land claim",
  description:
    "A land claim (zone) by id from forum_profile_section zones: owner, name, server, created, position, " +
    "coordinates, size, and residents (who is registered in it, since when). A hidden zone has no owner, " +
    "position or residents (hidden:true).",
  inputSchema: { zoneId: z.number().int().positive() },
  annotations: readOnly,
  handler: async ({ zoneId }, { reader }) => jsonResult(await reader.zone(zoneId)),
});

export const profileTools = [getProfile, profileSection, zoneInfo];
