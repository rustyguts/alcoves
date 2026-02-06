import { resolve } from "node:path";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "nuxt-auth-utils"],
  css: ["~/assets/css/main.css"],
  typescript: {
    typeCheck: true,
  },
  vue: {
    compilerOptions: {
      isCustomElement: (tag: string) => tag.startsWith("media-"),
    },
  },
  runtimeConfig: {
    session: {
      password:
        process.env.ALCOVES_SESSION_SECRET || "alcoves-dev-secret-key-change-in-production!!",
    },
    oauth: {
      google: {
        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET || "",
      },
    },
    databaseUrl:
      process.env.ALCOVES_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/alcoves",
    storagePath: resolve(process.env.ALCOVES_STORAGE_PATH || "./data", "files"),
    public: {
      googleAuthEnabled: !!process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID,
    },
  },
});
