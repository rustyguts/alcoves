import { ref, computed, watch } from "vue";

export type ColorPreference = "auto" | "light" | "dark";

const STORAGE_KEY = "alcoves.theme";

const preference = ref<ColorPreference>(
  (localStorage.getItem(STORAGE_KEY) as ColorPreference) || "auto",
);

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const theme = computed<"light" | "dark">(() =>
  preference.value === "auto" ? getSystemTheme() : preference.value,
);

function applyTheme(mode: "light" | "dark") {
  const el = document.documentElement;
  el.classList.toggle("dark", mode === "dark");
  el.classList.toggle("light", mode === "light");
  el.style.colorScheme = mode;
}

applyTheme(theme.value);

watch(preference, (next) => {
  if (next === "auto") {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, next);
  }
  applyTheme(theme.value);
});

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (preference.value === "auto") applyTheme(theme.value);
  });
}

export function useTheme() {
  return { theme, preference };
}
