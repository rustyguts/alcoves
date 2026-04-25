/**
 * Injects an early script into every SSR response that swallows `submit`
 * events fired before Vue hydrates. Without this, a user who clicks a
 * `<button type="submit">` during the SSR→hydration window triggers the
 * browser's native form POST/GET, which reloads the page with the form data
 * in the URL and silently drops the user's intent.
 *
 * The paired client plugin (`app/plugins/form-guard.client.ts`) sets
 * `window.__nuxtReady = true` on `app:mounted`, after which submits flow
 * through to Vue's own `@submit.prevent` handlers as normal.
 */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("render:html", (html) => {
    html.bodyPrepend.unshift(
      `<script>(function(){document.addEventListener('submit',function(e){if(!window.__nuxtReady)e.preventDefault();},true);})();</script>`,
    );
  });
});
