import { createApp, type App } from "vue";

/**
 * Run a composable inside a real (headless) component instance so its
 * `watch`/lifecycle effects are owned by a scope we can tear down. Returns the
 * composable result plus the app — call `app.unmount()` (or use `mountComposable`
 * with an afterEach) to stop watchers and fire onUnmounted/onBeforeUnmount.
 *
 * Without this, composables invoked bare in a test leak their watchers into the
 * global reactivity scope, which bleeds state (and stray rejections) across tests.
 */
export function withSetup<T>(composable: () => T): { result: T; app: App } {
  let result!: T;
  const app = createApp({
    setup() {
      result = composable();
      return () => null;
    },
  });
  app.mount(document.createElement("div"));
  return { result, app };
}
