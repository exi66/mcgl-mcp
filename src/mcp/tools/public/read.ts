import { z } from "zod";
import { DEFAULT_PAGE_SIZE } from "../../../forum/reader.js";
import { definePublicTool, jsonResult } from "../../define-tool.js";

// Описания на английском: так меньше токенов в контексте агента.
// Контент форума (названия, посты) остаётся на русском.

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;
// Добавляется к каждому описанию: jsonResult опускает false-флаги.
const FLAGS_NOTE = " Boolean flags appear only when true.";
const page = z.number().int().positive().default(1).describe("1-based page number");

const TOPIC_ROW_FIELDS =
  "Topic fields: pinned; closed (title struck through on the forum, no replies allowed); " +
  "whoCanReply: all | vip | premium_platinum | moderators (only visible in topic lists, not on the topic page); " +
  "pages (topic page count); created/last: author and time; author.group is the player's privilege (paid or staff role, e.g. vip, platinum, admin); 'girls' is only a nick color anyone can pick, not gender." +
  FLAGS_NOTE;

export const listSections = definePublicTool({
  name: "forum_list_sections",
  title: "Forum sections",
  description:
    "Sections of the Minecraft Galaxy general forum (ids 1-11) grouped by category, with description, " +
    "topic/reply counts and last post. Use the id with forum_list_topics. Content is in Russian.",
  inputSchema: {},
  annotations: readOnly,
  handler: async (_args, { reader }) => jsonResult(await reader.sections()),
});

export const latestTopics = definePublicTool({
  name: "forum_latest_topics",
  title: "Latest topics",
  description:
    "Recently active topics across all sections, newest first; each row includes its section name. " + TOPIC_ROW_FIELDS,
  inputSchema: { page },
  annotations: readOnly,
  handler: async ({ page }, { reader }) => jsonResult(await reader.latestTopics(page)),
});

export const listTopics = definePublicTool({
  name: "forum_list_topics",
  title: "Section topics",
  description:
    "Topics of one section, pinned first, then by last activity. Section ids come from forum_list_sections. " +
    TOPIC_ROW_FIELDS,
  inputSchema: {
    sectionId: z.number().int().min(1).max(11).describe("Section id, 1-11"),
    page,
  },
  annotations: readOnly,
  handler: async ({ sectionId, page }, { reader }) => jsonResult(await reader.sectionTopics(sectionId, page)),
});

export const getTopic = definePublicTool({
  name: "forum_get_topic",
  title: "Topic page",
  description:
    "Posts of a topic. Without page: the newest pageSize posts (latest:true) - usually what is needed. " +
    "With page: pages counted from the topic start, pageSize posts each (default 15); the page holding post #N " +
    "is ceil(N/pageSize). Post numbers (#N) are continuous. Returns title, section, totalPages, totalPosts, " +
    "posts (number, id, author, postedAt, text, rating; deleted posts are {deleted:true}). The latest view and " +
    "page 1 also include poll (if any), notices (e.g. 'moved from section') and current readers. " +
    "author.accountDeleted: account removed or banned; author.group is the player's privilege (paid or staff role, e.g. vip, platinum, admin); 'girls' is only a nick color anyone can pick, not gender. " +
    "Post text markup: [quote: nick]..[/quote], [spoiler: title]..[/spoiler], [image: url], [video: url], " +
    "[audio: url], [Item name #id] or [item #id] (#id:meta for variants), [craft] grid of item ids with a legend." +
    FLAGS_NOTE,
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
  handler: async ({ topicId, page, pageSize }, { reader }) => jsonResult(await reader.topic(topicId, page, pageSize)),
});

export const getPost = definePublicTool({
  name: "forum_get_post",
  title: "Single post",
  description:
    "One post by id (e.g. from a /post/2120899 link) with its number in the topic, plus the topic and the " +
    "forum_get_topic page (default pageSize) it is on. " +
    "Same post format as forum_get_topic.",
  inputSchema: { postId: z.number().int().positive() },
  annotations: readOnly,
  handler: async ({ postId }, { reader }) => jsonResult(await reader.post(postId)),
});

export const readTools = [listSections, latestTopics, listTopics, getTopic, getPost];
