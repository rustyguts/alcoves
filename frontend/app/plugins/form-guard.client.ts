export default defineNuxtPlugin({
  name: "form-guard",
  hooks: {
    "app:mounted"() {
      (window as unknown as { __nuxtReady?: boolean }).__nuxtReady = true;
    },
  },
});
