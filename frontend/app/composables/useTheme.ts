import { computed } from "vue";

export type ColorPreference = "auto" | "light" | "dark";

export function useTheme() {
  const colorMode = useColorMode();

  const preference = computed<ColorPreference>({
    get() {
      const v = colorMode.preference;
      if (v === "light" || v === "dark") return v;
      return "auto";
    },
    set(next) {
      colorMode.preference = next === "auto" ? "system" : next;
    },
  });

  const theme = computed<"light" | "dark">(() =>
    colorMode.value === "dark" ? "dark" : "light",
  );

  return { theme, preference };
}
