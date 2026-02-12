import { defineVitestConfig } from "@nuxt/test-utils/config";

export default defineVitestConfig({
  test: {
    name: "unit",
    globals: true,
    include: [
      "test/components/**/*.spec.ts",
      "test/composables/**/*.spec.ts",
      "test/middleware/**/*.spec.ts",
      "test/utils/**/*.spec.ts",
      "test/app/**/*.spec.ts",
      "test/pages/**/*.spec.ts",
      "test/layouts/**/*.spec.ts",
    ],
    environment: "nuxt",
    environmentOptions: {
      nuxt: {
        domEnvironment: "jsdom",
      },
    },
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      all: true,
      include: ["app/**/*.{ts,vue}"],
      exclude: ["app/pages/libraries/[id].vue", "app/types/**/*.d.ts", "**/*.d.ts", "**/*.spec.ts"],
      thresholds: {
        lines: 25,
        functions: 25,
        branches: 25,
        statements: 25,
      },
    },
  },
});
