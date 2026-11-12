import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Живые тесты ходят на настоящий форум: только через `pnpm test:live`.
    exclude: ["test/live/**", "node_modules/**"],
  },
});
