/** Ошибка, текст которой можно показать агенту как результат инструмента. */
export class ForumError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ForumError";
  }
}

/** Форум ответил страницей «войдите». Сессия будет переустановлена один раз. */
export class SessionExpiredError extends ForumError {
  constructor() {
    super("Forum session expired");
    this.name = "SessionExpiredError";
  }
}

/** Логин не удался: неверные креды, бан, капча и т.п. */
export class LoginFailedError extends ForumError {
  constructor(reason: string) {
    super(`Forum login failed: ${reason}`);
    this.name = "LoginFailedError";
  }
}

/** Разметка страницы не совпала с ожиданиями парсера. */
export class ParseError extends ForumError {
  constructor(what: string, url: string) {
    super(`Could not parse ${what} at ${url}. The forum markup may have changed.`);
    this.name = "ParseError";
  }
}

/** Форум не отвечает (сработал ForumHealth): запросы временно не отправляются. */
export class ForumUnavailableError extends ForumError {
  constructor(readonly retryInSec: number) {
    super(`The forum is not responding right now. Try again in ${retryInSec}s.`);
    this.name = "ForumUnavailableError";
  }
}
