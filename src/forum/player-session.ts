import { createLogger } from "../logger.js";
import { LoginFailedError, SessionExpiredError } from "./errors.js";
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
    if (isGuestPage(load(page.html))) throw new SessionExpiredError();
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

    this.username = username;
    logger.info(`Logged in as ${username}`);
    return username;
  }
}
