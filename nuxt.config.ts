import { resolve } from "node:path";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "@nuxt/image", "nuxt-auth-utils"],
  css: ["~/assets/css/main.css"],
  typescript: {
    typeCheck: true,
  },
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
    storagePath: process.env.ALCOVES_STORAGE_PATH || "./data",
  },
});
