import type { z } from "zod";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ForumReader } from "../forum/reader.js";
import type { PlayerSession } from "../forum/player-session.js";

type Shape = z.ZodRawShape;
type ShapeArgs<S extends Shape> = { [K in keyof S]: z.infer<S[K]> };

/**
 * Контекст публичного инструмента. В stdio-режиме с кредами reader читает
 * залогиненным (настройки игрока), на хосте — гостем.
 */
export interface PublicToolContext {
  reader: ForumReader;
}

/** Контекст инструмента игрока: всё, что нужно для действий от его имени. */
export interface PlayerToolContext extends PublicToolContext {
  session: PlayerSession;
}

interface BaseTool<S extends Shape> {
  name: string;
  title?: string;
  description: string;
  inputSchema: S;
  annotations?: ToolAnnotations;
}

export interface PublicTool<S extends Shape = Shape> extends BaseTool<S> {
  scope: "public";
  handler: (args: ShapeArgs<S>, ctx: PublicToolContext) => Promise<CallToolResult>;
}

export interface PlayerTool<S extends Shape = Shape> extends BaseTool<S> {
  scope: "player";
  handler: (args: ShapeArgs<S>, ctx: PlayerToolContext) => Promise<CallToolResult>;
}

// Стёртый generic для разнородных списков: каждый инструмент типизирован
// при объявлении, а массив не может выразить «массив разных generic-ов».
export type AnyTool = PublicTool<any> | PlayerTool<any>;

/** Инструмент без авторизации. Доступен и локально, и на хосте. */
export function definePublicTool<S extends Shape>(def: Omit<PublicTool<S>, "scope">): PublicTool<S> {
  return { ...def, scope: "public" };
}

/**
 * Инструмент от лица игрока. Регистрируется, только если есть сессия игрока.
 * Обращения к форуму внутри оборачивай в `ctx.session.withAuth(...)`, а
 * страницы получай через `ctx.session.getAuthed(...)`: так протухшая сессия
 * переустановится сама.
 */
export function definePlayerTool<S extends Shape>(def: Omit<PlayerTool<S>, "scope">): PlayerTool<S> {
  return { ...def, scope: "player" };
}

/**
 * Структурированный ответ: компактный JSON без отступов, а флаги `false`
 * опускаются (в описаниях инструментов сказано, что флаг есть только при true).
 * На странице темы в 100 постов это заметная экономия токенов.
 */
export function jsonResult(data: unknown): CallToolResult {
  const text = JSON.stringify(data, (_key, value) => (value === false ? undefined : value));
  return { content: [{ type: "text", text }] };
}
