import { ICONS } from "./utils/icons";

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
    // internal slot to Lineicons (via the ICONS registry) so no Lucide icon is
    // rendered anywhere. Edit glyphs in app/utils/icons.ts, not here.
    icons: {
      arrowDown: ICONS.arrowDown,
      arrowLeft: ICONS.back,
      arrowRight: ICONS.arrowRight,
      arrowUp: ICONS.arrowUp,
      caution: ICONS.warning,
      check: ICONS.check,
      chevronDoubleLeft: ICONS.chevronLeft,
      chevronDoubleRight: ICONS.chevronRight,
      chevronDown: ICONS.chevronDown,
      chevronLeft: ICONS.chevronLeft,
      chevronRight: ICONS.chevronRight,
      chevronUp: ICONS.chevronUp,
      close: ICONS.close,
      copy: ICONS.copy,
      copyCheck: ICONS.check,
      dark: ICONS.dark,
      drag: ICONS.drag,
      ellipsis: ICONS.ellipsis,
      error: ICONS.error,
      external: ICONS.external,
      eye: ICONS.eye,
      eyeOff: ICONS.eyeOff,
      file: ICONS.file,
      folder: ICONS.folder,
      folderOpen: ICONS.folderOpen,
      hash: ICONS.hash,
      info: ICONS.info,
      light: ICONS.light,
      loading: ICONS.loading,
      menu: ICONS.menu,
      minus: ICONS.minus,
      panelClose: ICONS.chevronLeft,
      panelOpen: ICONS.chevronRight,
      plus: ICONS.plus,
      reload: ICONS.reload,
      search: ICONS.search,
      stop: ICONS.stop,
      success: ICONS.success,
      system: ICONS.system,
      tip: ICONS.tip,
      upload: ICONS.upload,
      warning: ICONS.warning,
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
