import type { AnyTool } from "../define-tool.js";
import { playerCommunityTools } from "./player/communities.js";
import { messageTools } from "./player/messages.js";
import { postingTools } from "./player/posting.js";
import { profileTools } from "./player/profile.js";
import { communityTools } from "./public/communities.js";
import { readTools } from "./public/read.js";
import { userTools } from "./public/users.js";

/**
 * Реестр инструментов.
 *
 * Новый инструмент: объявить через `definePublicTool(...)` или
 * `definePlayerTool(...)` и добавить в нужный массив.
 * Player-инструменты автоматически не попадают в HTTP-режим.
 */
export const publicTools: AnyTool[] = [...readTools, ...userTools, ...communityTools];
export const playerTools: AnyTool[] = [...playerCommunityTools, ...profileTools, ...postingTools, ...messageTools];
