import { useColorMode } from "@vueuse/core";

const colorMode = useColorMode({
  attribute: "data-theme",
  modes: {
    light: "light",
    dark: "dark",
  },
});

export function useTheme() {
  return {
    /** The resolved (effective) theme: always "light" or "dark" */
    theme: computed(() => colorMode.value),
    /** The user preference: "light", "dark", or "auto" */
    preference: colorMode.store,
  };
}
