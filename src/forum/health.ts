import { createLogger } from "../logger.js";
import { ForumUnavailableError } from "./errors.js";

const logger = createLogger("forum-health");

export interface ForumHealthOptions {
  /** Сколько запросов подряд должно упасть (уже после повторов), чтобы считать форум лежащим. */
  failureThreshold?: number;
  /** Сколько не ходить на форум после этого, мс. */
  cooldownMs?: number;
  now?: () => number;
}

/**
 * Circuit breaker для форума. Форум периодически лежит; без этого каждый вызов
 * инструмента ждал бы таймауты всех повторов.
 *
 * - closed: запросы идут как обычно;
 * - open: после `failureThreshold` неудачных запросов подряд форум считается
 *   лежащим, запросы сразу получают ForumUnavailableError;
 * - через `cooldownMs` пропускается один пробный запрос (half-open): успех
 *   закрывает breaker, неудача снова открывает его на cooldown.
 *
 * Один экземпляр на процесс, общий для всех ForumHttp.
 */
export class ForumHealth {
  private failures = 0;
  private openUntil = 0;
  private probing = false;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: ForumHealthOptions = {}) {
    this.threshold = options.failureThreshold ?? 2;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  /** Бросает ForumUnavailableError, если форум сейчас считается лежащим. */
  check(): void {
    if (this.failures < this.threshold) return;
    const wait = this.openUntil - this.now();
    if (wait > 0 || this.probing) {
      throw new ForumUnavailableError(Math.max(1, Math.ceil(Math.max(wait, 1000) / 1000)));
    }
    // Cooldown прошёл: пропускаем один пробный запрос.
    this.probing = true;
  }

  success(): void {
    if (this.failures >= this.threshold) logger.info("Forum is back up");
    this.failures = 0;
    this.probing = false;
  }

  failure(): void {
    this.failures++;
    this.probing = false;
    if (this.failures >= this.threshold) {
      if (this.failures === this.threshold)
        logger.warn(`Forum looks down, pausing requests for ${this.cooldownMs / 1000}s`);
      this.openUntil = this.now() + this.cooldownMs;
    }
  }

  get status(): { up: boolean; retryInSec?: number } {
    if (this.failures < this.threshold) return { up: true };
    return { up: false, retryInSec: Math.max(0, Math.ceil((this.openUntil - this.now()) / 1000)) };
  }
}
