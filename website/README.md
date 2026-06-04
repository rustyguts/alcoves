# Alcoves website (`website/`)

The public **marketing landing page + product documentation** for Alcoves,
built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build)
and deployed as a fully static site to **GitHub Pages** at
[alcoves.io](https://alcoves.io).

- **Landing page** — a fully custom, hand-designed page at `/`
  (`src/pages/index.astro` + `src/components/landing/*`), dark-first, in the
  app's emerald/zinc identity with IBM Plex Sans / Fraunces / IBM Plex Mono.
- **Docs** — GitBook-style Starlight docs under content collection
  `src/content/docs/**`, with local [Pagefind](https://pagefind.app) search,
  light/dark, sidebar nav, and on-page TOC.

> The docs here are **starter samples** distilled from the repo's `docs/*.md`
> and `docs/vision.md`. The real docs have not been migrated yet.

## Develop

Run everything with [Bun](https://bun.com) from this directory:

```sh
bun install          # install dependencies
bun run dev          # dev server at http://localhost:4321
bun run build        # static build into dist/
bun run preview      # serve the production build
bun run check        # astro check (types + content + links)
```

## Structure

```
src/
  pages/index.astro            # custom landing page (Astro, not Starlight)
  layouts/LandingLayout.astro  # landing shell: meta/OG, fonts, theme toggle
  components/
    site/                      # shared nav + footer
    landing/                   # hero, bento, how-it-works, FAQ, CTA, stats
  content/docs/**              # Starlight docs (Markdown / MDX)
  styles/
    global.css                 # Starlight theme (emerald accent, zinc gray)
    landing.css                # bespoke landing design system
  assets/logo.webp             # brand mark (copied from frontend/public)
public/
  CNAME                        # alcoves.io (custom domain)
  og-image.png                 # social card (regenerate via scripts/generate-og.mjs)
  robots.txt, favicon.*
astro.config.mjs               # site, Starlight + sitemap integrations
```

### Routing

The landing page owns `/`. Docs live at clean top-level routes
(`/overview/`, `/getting-started/quickstart/`, `/concepts/architecture/`, …) —
there is intentionally **no docs page at `/`** so it doesn't collide with the
custom landing. The landing's "Docs" links point at `/overview/`.

### Regenerating the social card

```sh
bun scripts/generate-og.mjs   # writes public/og-image.png (uses sharp)
```

## Deployment

CI is `.github/workflows/website.yml` (at the repo root):

- **On PRs** that touch `website/**`: install → `check` → `build` (validation only).
- **On push to `main`**: the same, then deploy the static `dist/` to GitHub Pages.

### One-time setup (not automated)

1. **Repo → Settings → Pages → Build and deployment → Source = "GitHub Actions"**.
2. **DNS for the apex `alcoves.io`** — add four `A` records pointing at GitHub
   Pages, plus `AAAA` records for IPv6:

   ```
   A     @   185.199.108.153
   A     @   185.199.109.153
   A     @   185.199.110.153
   A     @   185.199.111.153
   AAAA  @   2606:50c0:8000::153
   AAAA  @   2606:50c0:8001::153
   AAAA  @   2606:50c0:8002::153
   AAAA  @   2606:50c0:8003::153
   ```

   (Optionally add a `CNAME` for `www` → `rustyguts.github.io`.)
3. In **Settings → Pages**, set the custom domain to `alcoves.io` (matches
   `public/CNAME`) and, once the certificate provisions, enable **Enforce HTTPS**.

Because the site is served from the apex root, `astro.config.mjs` sets only
`site` (no `base` path).
