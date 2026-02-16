import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag: string) => tag.startsWith("media-"),
        },
      },
    }),
    AutoImport({
      imports: ["vue", "vue-router"],
    }),
  ],
  resolve: {
    alias: {
      "~": new URL("./app", import.meta.url).pathname,
      "~~": new URL(".", import.meta.url).pathname,
      "@": new URL("./app", import.meta.url).pathname,
      "~~/": new URL("./", import.meta.url).pathname,
    },
  },
  test: {
    name: "unit",
    globals: true,
    include: [
      "test/components/**/*.spec.ts",
      "test/composables/**/*.spec.ts",
      "test/utils/**/*.spec.ts",
      "test/app/**/*.spec.ts",
      "test/pages/**/*.spec.ts",
      "test/layouts/**/*.spec.ts",
      "test/router/**/*.spec.ts",
    ],
    environment: "jsdom",
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
