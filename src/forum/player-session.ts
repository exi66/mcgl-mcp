import { createLogger } from "../logger.js";
import { ForumError, LoginFailedError, SessionExpiredError } from "./errors.js";
import type { ForumHttp, ForumPage } from "./http.js";
import { alertText, currentUser, isGuestPage, load } from "./parsers/common.js";
import { parseLoginForm } from "./parsers/player.js";
import { site } from "./site.js";

const logger = createLogger("player-session");

export interface PlayerCredentials {
  login: string;
  password: string;
}

/**
 * Залогиненная сессия одного игрока поверх своего ForumHttp (своих кук).
 *
 * - Логин ленивый: при первом вызове withAuth.
 * - Если операция бросила SessionExpiredError (PHPSESSID протух), сессия
 *   перелогинивается и повторяет операцию один раз.
 * - Параллельные вызовы ждут один и тот же логин.
 * - После неудачного логина новые попытки не делаются: у форума лимит
 *   попыток входа («Попыток входа осталось: N»), и долбить его неверным
 *   паролем нельзя. Чтобы попробовать снова, процесс перезапускается.
 */
export class PlayerSession {
  private loginInFlight?: Promise<string>;
  private username?: string;

  /** Ник, под которым сессия залогинена (после первого входа). */
  get nick(): string | undefined {
    return this.username;
  }
  private loginFailure?: LoginFailedError;

  constructor(
    readonly http: ForumHttp,
    private readonly credentials: PlayerCredentials,
  ) {}

  async withAuth<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.username) await this.login();
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) throw error;
      logger.info("Session expired, logging in again");
      this.username = undefined;
      await this.login();
      return operation();
    }
  }

  /** GET страницы от имени игрока; если форум считает нас гостем, бросает SessionExpiredError. */
  async getAuthed(path: string): Promise<ForumPage> {
    const page = await this.http.get(path);
    const $ = load(page.html);
    if (isGuestPage($)) throw new SessionExpiredError();
    assertAccountUsable($);
    return page;
  }

  async whoami(): Promise<string> {
    return this.withAuth(async () => {
      const username = currentUser(load((await this.getAuthed(site.sessionCheck())).html));
      if (!username) throw new SessionExpiredError();
      return username;
    });
  }

  private login(): Promise<string> {
    if (this.loginFailure) return Promise.reject(this.loginFailure);
    this.loginInFlight ??= this.doLogin()
      .catch((error: unknown) => {
        if (error instanceof LoginFailedError) this.loginFailure = error;
        throw error;
      })
      .finally(() => {
        this.loginInFlight = undefined;
      });
    return this.loginInFlight;
  }

  private async doLogin(): Promise<string> {
    this.http.jar.clear();

    const form = await this.http.get(site.loginPage());
    // Успех: 302 на ref (/main/). Неудача: 302 на /guilogin/4?f=N с плашкой ошибки.
    const result = await this.http.postForm(site.loginSubmit(), {
      ...parseLoginForm(form),
      login: this.credentials.login,
      pass: this.credentials.password,
    });

    const $ = load(result.html);
    const username = isGuestPage($) ? undefined : currentUser($);
    if (!username) {
      throw new LoginFailedError(alertText($) ?? "unknown reason");
    }

    try {
      assertAccountUsable($);
    } catch (error) {
      // Не перелогиниваемся на каждом вызове: без участия игрока это не исправить.
      throw new LoginFailedError((error as Error).message);
    }
    this.username = username;
    logger.info(`Logged in as ${username}`);
    return username;
  }
}

/**
 * Вход прошёл, но форум вместо содержимого любой страницы показывает:
 * - форму одноразового кода (у аккаунта двухфакторная авторизация, input onepass);
 * - «Доступ к аккаунту заблокирован!» (вход с IP не из списка разрешённых).
 * Пройти это сервер не может — объясняем, а не падаем на парсерах.
 */
export function assertAccountUsable($: ReturnType<typeof load>): void {
  if ($('input[name="onepass"]').length) {
    throw new ForumError(
      "The account uses two-factor authentication: the forum asks for a one-time code on every new login, " +
        "which this server cannot enter. Use an account without 2FA.",
    );
  }
  if (/Доступ к аккаунту заблокирован/.test(alertText($) ?? "")) {
    throw new ForumError(
      "The forum blocked access from this IP for the account (IP restriction in its security settings). " +
        "Unlock it on the site (code word, e-mail or phone) or add this IP to the allowed list.",
    );
  }
}
