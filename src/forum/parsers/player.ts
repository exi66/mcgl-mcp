import type { ForumPage } from "../http.js";
import { ParseError } from "../errors.js";
import { load } from "./common.js";

/**
 * Скрытые поля формы логина:
 * - fcode обязателен: без него форум отвечает как на неверный пароль
 *   и списывает попытку входа;
 * - recap (токен reCAPTCHA v3) сервер не проверяет, уходит пустым.
 */
export function parseLoginForm(page: ForumPage): Record<string, string> {
  const $ = load(page.html);
  const form = $('form[action="/login.php"]').first();
  if (!form.length) throw new ParseError("login form", page.url);

  const fields: Record<string, string> = {};
  form.find('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr("name");
    if (name) fields[name] = $(el).attr("value") ?? "";
  });
  if (!fields.fcode) throw new ParseError("login form (fcode)", page.url);
  return fields;
}
