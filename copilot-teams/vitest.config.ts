import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/logger.ts"],
      thresholds: {
        "src/state.ts": { lines: 90, branches: 85 },
        "src/tmux.ts": { lines: 90, branches: 85 },
        "src/copilot.ts": { lines: 90, branches: 85 },
      },
    },
  },
});
