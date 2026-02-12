import { defineVitestConfig } from "@nuxt/test-utils/config";

export default defineVitestConfig({
  test: {
    name: "e2e",
    include: ["test/e2e/**/*.spec.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    coverage: {
      enabled: false,
    },
  },
});
