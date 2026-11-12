/**
 * Простейшее хранилище кук на один хост форума. Path, domain и secure
 * не учитываются: мы всегда ходим на один и тот же origin.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Применяет заголовки Set-Cookie из ответа. */
  absorb(headers: Headers): void {
    for (const raw of headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();

      const expired = attrs.some((a) => {
        const [k, v = ""] = a.split("=").map((s) => s.trim());
        const key = k.toLowerCase();
        if (key === "max-age") return Number(v) <= 0;
        if (key === "expires") return Date.parse(v) <= Date.now();
        return false;
      });

      if (expired || value === "" || value === "deleted") {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  clear(): void {
    this.cookies.clear();
  }
}
