import * as Sentry from "@sentry/nuxt";

// The @sentry/nuxt module wraps this file in a Nuxt plugin, so useRuntimeConfig()
// resolves the runtime-overridable public DSN (NUXT_PUBLIC_SENTRY_DSN). Empty
// string → SDK stays uninitialized (Sentry is optional).
const dsn = useRuntimeConfig().public.sentry?.dsn || "";

if (dsn) {
  Sentry.init({
    dsn,
    integrations: [
      // Browser profiling — captures CPU profiles attached to traces. Requires
      // the `Document-Policy: js-profiling` response header (set in nuxt.config).
      // oxlint flags this via the server export condition (@sentry/node); the
      // browser bundle resolves it through @sentry/vue → @sentry/browser.
      // oxlint-disable-next-line import/namespace
      Sentry.browserProfilingIntegration(),
    ],

    // Capture 20% of transactions for performance tracing.
    tracesSampleRate: 0.2,

    // "trace" ties profiling to sampled traces automatically; the default
    // ("manual") would require explicit startProfiler()/stopProfiler() calls
    // and capture nothing.
    profileLifecycle: "trace",
    // Profile 100% of profiling sessions (gated further by tracesSampleRate).
    profileSessionSampleRate: 1.0,

    // Propagate Sentry trace headers on requests to our own API so backend
    // spans join the same distributed trace. Matches both the relative
    // `/api/*` (Nitro proxy) and absolute `<origin>/api/*` (apiOrigin) forms.
    tracePropagationTargets: [/^\/api\//, /^https?:\/\/[^/]+\/api\//],

    // Forward structured logs (console.error etc.) to Sentry.
    enableLogs: true,
  });
}
