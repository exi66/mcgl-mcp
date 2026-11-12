import type { AnyTool } from "../define-tool.js";
import { readTools } from "./public/read.js";
import { userTools } from "./public/users.js";

/**
 * Реестр инструментов.
 *
 * Новый инструмент: объявить через `definePublicTool(...)` или
 * `definePlayerTool(...)` и добавить в нужный массив.
 * Player-инструменты автоматически не попадают в HTTP-режим.
 */
export const publicTools: AnyTool[] = [...readTools, ...userTools];
export const playerTools: AnyTool[] = [];
