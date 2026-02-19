export const daisyThemes = [
  "light",
  "dark",
  "cupcake",
  "bumblebee",
  "emerald",
  "corporate",
  "synthwave",
  "retro",
  "cyberpunk",
  "valentine",
  "halloween",
  "garden",
  "forest",
  "aqua",
  "lofi",
  "pastel",
  "fantasy",
  "wireframe",
  "black",
  "luxury",
  "dracula",
  "cmyk",
  "autumn",
  "business",
  "acid",
  "lemonade",
  "night",
  "coffee",
  "winter",
  "dim",
  "nord",
  "sunset",
  "caramellatte",
  "abyss",
  "silk",
] as const;

export type DaisyTheme = (typeof daisyThemes)[number];

const STORAGE_KEY = "alcoves.theme";

const preference = ref<DaisyTheme | "auto">(
  (localStorage.getItem(STORAGE_KEY) as DaisyTheme | "auto") || "auto",
);

function getSystemTheme(): DaisyTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const resolvedTheme = computed<DaisyTheme>(() =>
  preference.value === "auto" ? getSystemTheme() : preference.value,
);

function applyTheme(theme: DaisyTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

// Apply on load
applyTheme(resolvedTheme.value);

// React to changes
watch(preference, (next) => {
  if (next === "auto") {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, next);
  }
  applyTheme(resolvedTheme.value);
});

// Listen for system theme changes when in auto mode
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (preference.value === "auto") {
      applyTheme(resolvedTheme.value);
    }
  });
}

export function useTheme() {
  return {
    /** The resolved (effective) theme name */
    theme: resolvedTheme,
    /** The user preference: a theme name or "auto" */
    preference,
  };
}
