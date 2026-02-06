import { resolve } from "node:path";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "@nuxt/image"],
  css: ["~/assets/css/main.css"],
  vue: {
    compilerOptions: {
      isCustomElement: (tag: string) => tag.startsWith("media-"),
    },
  },
  image: {
    ipx: {
      sharpOptions: {
        autoOrient: true,
      },
      fs: {
        dir: resolve(process.env.ALCOVES_STORAGE_PATH || "./data"),
      },
    },
  },
  runtimeConfig: {
    sessionSecret:
      process.env.ALCOVES_SESSION_SECRET || "alcoves-dev-secret-key-change-in-production!!",
    databaseUrl:
      process.env.ALCOVES_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/alcoves",
    storagePath: process.env.ALCOVES_STORAGE_PATH || "./data",
  },
});
