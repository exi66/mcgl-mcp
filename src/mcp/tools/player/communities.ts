import { z } from "zod";
import { changeMembership } from "../../../forum/community-actions.js";
import { DEFAULT_PAGE_SIZE } from "../../../forum/reader.js";
import { definePlayerTool, jsonResult } from "../../define-tool.js";

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

export const communitySections = definePlayerTool({
  name: "forum_community_sections",
  title: "Community forum sections",
  description:
    "Forum sections of a community, grouped by category: id, title, description, topic/reply counts, last post. " +
    "membersOnly: true for every category except the public one - readable only by community members. " +
    "Use the section id with forum_community_topics.",
  inputSchema: { communityId: z.number().int().positive() },
  annotations: readOnly,
  handler: async ({ communityId }, { reader }) => jsonResult(await reader.communityForum(communityId)),
});

export const communityTopic = definePlayerTool({
  name: "forum_community_topic",
  title: "Community topic",
  description:
    "Posts of a community topic (rows with inCommunity:true), same format and paging as forum_get_topic: " +
    "without page the newest posts, page counts from the start. Also returns the community and section. " +
    "Topic ids are global across communities: take them only from topic lists, do not guess.",
  inputSchema: {
    topicId: z.number().int().positive(),
    page: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("1-based page from the topic start; omit for the newest posts"),
    pageSize: z.number().int().min(1).max(50).default(DEFAULT_PAGE_SIZE).describe("Posts per page"),
  },
  annotations: readOnly,
  handler: async ({ topicId, page, pageSize }, { reader }) =>
    jsonResult(await reader.topic(topicId, page, pageSize, "hpost")),
});

export const myCommunities = definePlayerTool({
  name: "forum_my_communities",
  title: "My communities",
  description: "Communities the logged-in player is a member of: id and name.",
  inputSchema: {},
  annotations: readOnly,
  handler: async (_args, { reader }) => jsonResult(await reader.myCommunities()),
});

export const myCommunityTopics = definePlayerTool({
  name: "forum_my_community_topics",
  title: "Topics from my communities",
  description:
    "Recently active topics from all communities the player is a member of (up to 30), newest first. " +
    "sectionId is the community section of each topic. Read a topic with forum_community_topic.",
  inputSchema: {},
  annotations: readOnly,
  handler: async (_args, { reader }) => jsonResult(await reader.myCommunityTopics()),
});

export const joinCommunity = definePlayerTool({
  name: "forum_join_community",
  title: "Join community",
  description:
    "Joins a community on behalf of the player, accepting its joining terms. Ask the user to confirm first. " +
    "Fails with the forum's reason if the community is closed or the player does not meet its conditions " +
    "(check with forum_get_community: membership must be can_join). Returns the community state after joining.",
  inputSchema: { communityId: z.number().int().positive() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async ({ communityId }, { session }) => jsonResult(await changeMembership(session, communityId, "join")),
});

export const leaveCommunity = definePlayerTool({
  name: "forum_leave_community",
  title: "Leave community",
  description:
    "Leaves a community on behalf of the player. Ask the user to confirm first: rejoining may be impossible " +
    "(closed community or joining conditions). Returns the community state after leaving.",
  inputSchema: { communityId: z.number().int().positive() },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ communityId }, { session }) => jsonResult(await changeMembership(session, communityId, "leave")),
});

export const playerCommunityTools = [
  communitySections,
  communityTopic,
  myCommunities,
  myCommunityTopics,
  joinCommunity,
  leaveCommunity,
];
