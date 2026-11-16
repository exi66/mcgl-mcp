import { z } from "zod";
import { definePublicTool, jsonResult } from "../../define-tool.js";

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;
const page = z.number().int().positive().default(1).describe("1-based page number");

export const listCommunities = definePublicTool({
  name: "forum_list_communities",
  title: "Communities",
  description:
    "Player communities (user sub-forums), 20 per page: id, name, rating place, leader, members, open, topics, posts. " +
    "open: anyone may join on their own (the community may still require playtime); closed: by application only. " +
    "title searches by substring of the name (then totalPages is unknown, use hasMore). " +
    "sort: 0 rating, 1 name, 2 topics, 3 creation date, 4 posts. Boolean flags (open, hasMore) appear only when true.",
  inputSchema: {
    title: z.string().trim().min(1).max(64).optional().describe("Search by part of the community name"),
    sort: z.number().int().min(0).max(4).default(0),
    page,
  },
  annotations: readOnly,
  handler: async ({ title, sort, page }, { reader }) => jsonResult(await reader.communities({ title, sort, page })),
});

export const getCommunity = definePublicTool({
  name: "forum_get_community",
  title: "Community",
  description:
    "A community's main page: name, leader, members, rating place, description. When logged in also " +
    "membership: member | can_join | blocked (joinBlockedReason, e.g. not enough playtime) | closed (by application). " +
    "Its forum sections: forum_community_sections (requires login).",
  inputSchema: { communityId: z.number().int().positive() },
  annotations: readOnly,
  handler: async ({ communityId }, { reader }) => jsonResult(await reader.community(communityId)),
});

export const communityTopics = definePublicTool({
  name: "forum_community_topics",
  title: "Community section topics",
  description:
    "Topics of a community forum section, same row format as forum_list_topics, plus the community it belongs to. " +
    "Section ids are global across communities: take them only from forum_community_sections, do not guess. " +
    "Sections with membersOnly:false are readable by anyone (guests too); membersOnly ones need login and membership. " +
    "Read a topic with forum_community_topic.",
  inputSchema: {
    sectionId: z.number().int().positive(),
    page,
  },
  annotations: readOnly,
  handler: async ({ sectionId, page }, { reader }) => jsonResult(await reader.communitySectionTopics(sectionId, page)),
});

export const communityTools = [listCommunities, getCommunity, communityTopics];
