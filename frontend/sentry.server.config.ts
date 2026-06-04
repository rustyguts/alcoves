import * as Sentry from "@sentry/nuxt";

// DSN is read from the environment at Nitro server start.
const dsn = process.env.NUXT_PUBLIC_SENTRY_DSN || "";

if (dsn) {
  Sentry.init({
    dsn,

    // Capture 20% of transactions for server-side tracing.
    tracesSampleRate: 0.2,

    // Forward structured logs (console.error etc.) to Sentry.
    enableLogs: true,
  });
}
