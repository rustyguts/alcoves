import { vite as vidstack } from "vidstack/plugins";

const apiTarget = process.env.ALCOVES_API_URL || "http://localhost:3001";

export default defineNuxtConfig({
  ssr: true,
  compatibilityDate: "2025-11-01",
  devtools: { enabled: false },

  modules: ["@nuxt/ui"],

  css: ["~/assets/css/main.css"],

  // Move Nuxt Icon's runtime endpoint off `/api/*` so it isn't captured by the
  // Go backend proxy below. Default is `/api/_nuxt_icon/*`.
  icon: {
    localApiEndpoint: "/_nuxt_icon",
  },

  app: {
    head: {
      title: "Alcoves",
      htmlAttrs: { lang: "en", class: "h-full" },
      bodyAttrs: { class: "h-full bg-neutral-50 dark:bg-neutral-950" },
      link: [
        { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon.png" },
        { rel: "shortcut icon", href: "/favicon.ico" },
      ],
    },
  },

  runtimeConfig: {
    apiUrl: apiTarget,
    public: {
      googleAuthEnabled: process.env.VITE_GOOGLE_AUTH_ENABLED === "true",
      // Public-facing API origin used by the client for direct streaming
      // (e.g. video <source>) so big binary requests bypass the Nitro dev proxy
      // which can mangle Range responses. Defaults to empty → fall back to the
      // current page origin (relative URLs go through the proxy).
      apiOrigin: process.env.NUXT_PUBLIC_API_ORIGIN || "",
    },
  },

  ui: {
    theme: {
      colors: ["primary", "secondary", "success", "info", "warning", "error"],
    },
  },

  colorMode: {
    classSuffix: "",
    preference: "system",
    fallback: "light",
    storageKey: "alcoves.theme",
  },

  vue: {
    compilerOptions: {
      isCustomElement: (tag: string) => tag.startsWith("media-"),
    },
  },

  vite: {
    plugins: [vidstack()],
  },

  nitro: {
    // Nitro's devProxy strips the matched prefix before appending the rest to
    // the target URL. The Go backend mounts routes under `/api/*`, so target
    // must include the `/api` suffix to rebuild the original path.
    devProxy: {
      "/api": { target: `${apiTarget}/api`, changeOrigin: true, ws: true },
    },
    routeRules: {
      "/api/**": { proxy: `${apiTarget}/api/**` },
      // Only the public share pages benefit from SSR (SEO + OG tags). Every
      // other route is either auth-gated (so SSR requires backend access on
      // the SSR request, which tests can't mock) or an interactive form
      // (which suffers from a native-form-submit race during hydration).
      "/**": { ssr: false },
      "/s/**": { ssr: true },
    },
    externals: {
      inline: ["vue", "@vue/server-renderer", "@vue/compiler-dom"],
    },
  },

  typescript: {
    strict: true,
  },

  imports: {
    dirs: ["composables/**", "utils/**"],
  },
});
