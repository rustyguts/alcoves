import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import ui from "@nuxt/ui/vite";
import { vite as vidstack } from "vidstack/plugins";

export default defineConfig({
  plugins: [
    vue({
      features: {
        prodDevtools: true,
      },
      template: {
        compilerOptions: {
          isCustomElement: (tag: string) => tag.startsWith("media-"),
        },
      },
    }),
    tailwindcss(),
    ui({
      colorMode: true,
      theme: {
        colors: ["primary", "secondary", "success", "info", "warning", "error"],
      },
      ui: {
        card: {
          slots: {
            root: "rounded-lg overflow-hidden",
            header: "p-4 sm:px-6",
            body: "p-4 sm:p-6",
            footer: "p-4 sm:px-6",
          },
          variants: {
            variant: {
              solid: { root: "bg-inverted text-inverted" },
              outline: {
                root: "bg-default ring ring-default divide-y divide-default",
              },
              soft: { root: "bg-elevated/50 divide-y divide-default" },
              subtle: {
                root: "bg-elevated/50 ring ring-default divide-y divide-default",
              },
            },
          },
          defaultVariants: { variant: "outline" },
        },
      },
      autoImport: {
        imports: ["vue", "vue-router"],
        dts: true,
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
        ws: true,
      },
    },
  },
});
