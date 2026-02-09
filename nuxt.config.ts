import { resolve } from "node:path";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  ssr: process.env.NUXT_TEST_NO_SSR !== "true",
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "nuxt-auth-utils"],
  css: ["~/assets/css/main.css"],
  typescript: {
    typeCheck: true,
  },
  // TODO :: There is a bug where building for prod hangs afer build complete
  hooks: {
    close: () => {
      if (process.env.VITEST) {
        return;
      }
      process.exit(0);
    },
  },
  // nitro: {
  //   preset: "bun",
  // },
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
      process.env.ALCOVES_DATABASE_URL || "postgres://postgres:postgres@localhost:5455/alcoves",
    storageDriver: process.env.ALCOVES_STORAGE_DRIVER || "local",
    storagePath: resolve(process.env.ALCOVES_STORAGE_PATH || "./data", "files"),
    avatarStoragePath:
      process.env.ALCOVES_AVATAR_STORAGE_PATH ||
      resolve(process.env.ALCOVES_STORAGE_PATH || "./data", "avatars"),
    storageCachePath:
      process.env.ALCOVES_CACHE_STORAGE_PATH ||
      resolve(process.env.ALCOVES_STORAGE_PATH || "./data", ".cache"),
    s3Storage: {
      bucket: process.env.ALCOVES_S3_BUCKET || "",
      region: process.env.ALCOVES_S3_REGION || "",
      endpoint: process.env.ALCOVES_S3_ENDPOINT || "",
      accessKeyId: process.env.ALCOVES_S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.ALCOVES_S3_SECRET_ACCESS_KEY || "",
      forcePathStyle: process.env.ALCOVES_S3_FORCE_PATH_STYLE === "true",
      prefixes: {
        files: process.env.ALCOVES_S3_FILES_PREFIX || "files",
        avatars: process.env.ALCOVES_S3_AVATARS_PREFIX || "avatars",
        cache: process.env.ALCOVES_S3_CACHE_PREFIX || "cache",
      },
    },
    public: {
      googleAuthEnabled: !!process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID,
    },
  },
});
