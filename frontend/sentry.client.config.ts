import * as Sentry from "@sentry/nuxt";

// DSN is injected via runtimeConfig.public.sentry.dsn → NUXT_PUBLIC_SENTRY_DSN.
// The module makes it available as an env var at build time.
const dsn =
  (import.meta.env.NUXT_PUBLIC_SENTRY_DSN as string | undefined) || "";

if (dsn) {
  Sentry.init({
    dsn,
    integrations: [
      // Browser profiling — captures CPU profiles attached to transactions.
      Sentry.browserProfilingIntegration(),
    ],

    // Capture 20% of transactions for performance tracing.
    tracesSampleRate: 0.2,

    // Profile 100% of sampled transactions (relative to tracesSampleRate).
    profileSessionSampleRate: 1.0,

    // Propagate Sentry trace headers on requests to our own API so backend
    // spans appear in the same distributed trace.
    tracePropagationTargets: [/^\/api\//, /^https?:\/\/[^/]+\/api\//],

    // Forward structured logs (console.error etc.) to Sentry.
    enableLogs: true,
  });
}
