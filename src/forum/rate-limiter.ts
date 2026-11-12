/**
 * Выдерживает минимальный интервал между запросами к форуму. Один экземпляр
 * на процесс, общий для всех клиентов: на хосте все пользователи ходят на
 * форум с одного IP, поэтому лимит считается на IP, а не на пользователя.
 */
export class RateLimiter {
  private tail: Promise<void> = Promise.resolve();
  private last = 0;

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const slot = this.tail.then(async () => {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
    });
    // Ошибка одного запроса не должна ломать очередь для остальных.
    this.tail = slot.catch(() => {});
    return slot.then(fn);
  }
}
