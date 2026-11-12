import { defineConfig } from "vitest/config";

// Креды игрока для живых тестов (необязательно) — из .env.
try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен
}

/** `pnpm test:live`: smoke-тесты на настоящем форуме. В CI не запускаются. */
export default defineConfig({
  test: {
    include: ["test/live/**/*.test.ts"],
    testTimeout: 60_000,
    // Не долбим форум параллельно.
    fileParallelism: false,
  },
});
