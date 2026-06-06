export default defineAppConfig({
  ui: {
    // One Dark Pro palette. Each accent maps to a custom color ramp defined in
    // app/assets/css/main.css; `neutral` points at Tailwind's `neutral` scale,
    // which that file overrides with the blue-tinted One Dark slate.
    colors: {
      primary: "onedarkblue",
      secondary: "onedarkpurple",
      success: "onedarkgreen",
      info: "onedarkcyan",
      warning: "onedarkamber",
      error: "onedarkred",
      neutral: "neutral",
    },
    // Nuxt UI's built-in component chrome (select/accordion chevrons, checkbox
    // ticks, modal/toast close, loaders, etc.) defaults to Lucide. Remap every
    // internal slot to Lineicons so no Lucide icon is rendered anywhere.
    icons: {
      arrowDown: "i-lineicons-arrow-down",
      arrowLeft: "i-lineicons-arrow-left",
      arrowRight: "i-lineicons-arrow-right",
      arrowUp: "i-lineicons-arrow-up",
      caution: "i-lineicons-warning",
      check: "i-lineicons-check",
      chevronDoubleLeft: "i-lineicons-chevron-left",
      chevronDoubleRight: "i-lineicons-chevron-right",
      chevronDown: "i-lineicons-chevron-down",
      chevronLeft: "i-lineicons-chevron-left",
      chevronRight: "i-lineicons-chevron-right",
      chevronUp: "i-lineicons-chevron-up",
      close: "i-lineicons-xmark",
      copy: "i-lineicons-clipboard",
      copyCheck: "i-lineicons-check",
      dark: "i-lineicons-night",
      drag: "i-lineicons-menu-meatballs-1",
      ellipsis: "i-lineicons-menu-meatballs-1",
      error: "i-lineicons-xmark-circle",
      external: "i-lineicons-link",
      eye: "i-lineicons-eye",
      eyeOff: "i-lineicons-eye",
      file: "i-lineicons-empty-file",
      folder: "i-lineicons-folder",
      folderOpen: "i-lineicons-folder",
      hash: "i-lineicons-link",
      info: "i-lineicons-info",
      light: "i-lineicons-sun",
      loading: "i-lineicons-spinner-solid",
      menu: "i-lineicons-menu",
      minus: "i-lineicons-minus",
      panelClose: "i-lineicons-chevron-left",
      panelOpen: "i-lineicons-chevron-right",
      plus: "i-lineicons-plus",
      reload: "i-lineicons-reload",
      search: "i-lineicons-search",
      stop: "i-lineicons-stop",
      success: "i-lineicons-check-circle-1",
      system: "i-lineicons-monitor",
      tip: "i-lineicons-bulb",
      upload: "i-lineicons-upload",
      warning: "i-lineicons-warning",
    },
    // Flat, card-free look: subtle tonal panels — a faint background fill with
    // no ring/border, no shadow, and a modest radius. Replaces the elevated
    // bordered "card" treatment app-wide. (Floating UI — dropdowns, popovers,
    // toasts — keeps its own elevation via the component themes, untouched.)
    card: {
      slots: {
        root: "rounded-md overflow-hidden",
        header: "p-4 sm:px-6",
        body: "p-4 sm:p-6",
        footer: "p-4 sm:px-6",
      },
      variants: {
        variant: {
          solid: { root: "bg-inverted text-inverted" },
          outline: { root: "bg-elevated/50" },
          soft: { root: "bg-elevated/50" },
          subtle: { root: "bg-elevated/50" },
        },
      },
      defaultVariants: { variant: "outline" },
    },
  },
});
