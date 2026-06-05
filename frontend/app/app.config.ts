export default defineAppConfig({
  ui: {
    colors: {
      primary: "emerald",
      neutral: "zinc",
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
