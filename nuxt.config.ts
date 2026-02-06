// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  modules: ["@nuxt/ui"],
  css: ["~/assets/css/main.css"],
  vue: {
    compilerOptions: {
      isCustomElement: (tag: string) => tag.startsWith("media-"),
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
