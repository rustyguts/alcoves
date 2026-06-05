package imageproxy

// VariantsVersion is bumped whenever the Variants registry below changes
// (a size/quality/format edit, or a new variant). The pre-warm maintenance loop
// stores the version it warmed each file at (files.image_proxy_warmed_version);
// bumping this constant — together with a one-line migration that resets
// image_proxy_warmed_version for affected rows — re-warms every file against the
// new set without any other code change.
const VariantsVersion = 2

// Variant describes one named image-proxy transform the app requests. This
// registry is the SINGLE SOURCE OF TRUTH for every (size, format, quality)
// combination used anywhere in Alcoves: the frontend builds proxy URLs from the
// mirror in frontend/shared/image-variants.ts, and the pre-warm maintenance job
// generates exactly these variants for every image. The two files MUST be kept
// in lockstep — a drift means the pre-warm warms cache keys the UI never
// requests (wasted work) or misses keys it does (no warm-cache benefit).
type Variant struct {
	// Name is the stable identifier shared with the frontend registry.
	Name string
	// MaxWidth / MaxHeight bound the output box (aspect ratio is preserved; the
	// processor only ever downscales). 0 means "unconstrained on that axis".
	MaxWidth  int
	MaxHeight int
	// Quality is the encoder quality 1-100.
	Quality int
	// Format is the output container: "jpeg", "webp", "avif", or "png".
	Format string
	// Cap controls how the request dimensions are chosen for a given source:
	//   - Cap=true  → clamp Max{Width,Height} DOWN to the source's own pixel
	//     dimensions, so a 500px-wide original is requested at w500 (not w720).
	//     This keeps the cache key identical to what the frontend asks for, and
	//     avoids storing an oversized box that the processor would never fill.
	//   - Cap=false → always request the fixed MaxWidth×MaxHeight box,
	//     regardless of source size (small fixed-grid thumbnails).
	// The frontend mirror applies the identical rule, so cache keys match.
	Cap bool
}

// Variants is the canonical, ordered list of every image-proxy variant the app
// uses. Mirrored 1:1 by frontend/shared/image-variants.ts.
//
//	search   80×80   q70 jpeg  fixed — search-result avatars (search.vue)
//	timeline 384×384 q80 webp  fixed — timeline grid (timeline.vue)
//	face     300×300 q80 jpeg  fixed — people / face grid (people/[personId].vue)
//	card     720×360 q82 jpeg  capped — library browser cards (LibraryEntryCard.vue)
//	preview  1920×1080 q90 jpeg capped — full-screen lightbox (FilePreview.vue)
var Variants = []Variant{
	{Name: "search", MaxWidth: 80, MaxHeight: 80, Quality: 70, Format: "jpeg", Cap: false},
	{Name: "timeline", MaxWidth: 384, MaxHeight: 384, Quality: 80, Format: "webp", Cap: false},
	{Name: "face", MaxWidth: 300, MaxHeight: 300, Quality: 80, Format: "jpeg", Cap: false},
	{Name: "card", MaxWidth: 720, MaxHeight: 360, Quality: 82, Format: "jpeg", Cap: true},
	{Name: "preview", MaxWidth: 1920, MaxHeight: 1080, Quality: 90, Format: "jpeg", Cap: true},
}

// Resolve returns the concrete TransformOptions for this variant against a
// source image of the given pixel dimensions (pass nil when a dimension is
// unknown). The resulting cache key (see TransformCacheKey) is exactly the one
// the frontend requests for the same variant + file, so a pre-warmed entry is a
// guaranteed cache hit.
func (v Variant) Resolve(srcWidth, srcHeight *int) TransformOptions {
	w, h := v.MaxWidth, v.MaxHeight
	if v.Cap {
		if srcWidth != nil && *srcWidth > 0 && *srcWidth < w {
			w = *srcWidth
		}
		if srcHeight != nil && *srcHeight > 0 && *srcHeight < h {
			h = *srcHeight
		}
	}
	return TransformOptions{Width: w, Height: h, Quality: v.Quality, Format: v.Format}
}
