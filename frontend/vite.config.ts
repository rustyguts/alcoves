import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import ui from "@nuxt/ui/vite";
import { vite as vidstack } from "vidstack/plugins";

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag: string) => tag.startsWith("media-"),
        },
      },
    }),
    ui({
      autoImport: {
        imports: ["vue", "vue-router"],
      },
    }),
    vidstack(),
  ],
  resolve: {
    alias: {
      "~": new URL("./app", import.meta.url).pathname,
      "~~": new URL(".", import.meta.url).pathname,
      "@": new URL("./app", import.meta.url).pathname,
      "~~/": new URL("./", import.meta.url).pathname,
    },
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.ALCOVES_API_URL || "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
