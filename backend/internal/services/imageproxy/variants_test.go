package imageproxy_test

import (
	"testing"

	"github.com/alcoves/alcoves-backend/internal/services/imageproxy"
)

func iptr(i int) *int { return &i }

// TestVariantResolveCacheKeys is the contract guard for the single source of
// truth: the cache key each variant resolves to MUST equal exactly what the
// frontend mirror (frontend/shared/image-variants.ts) requests, or the pre-warm
// warms keys the UI never asks for. If you change a variant here, change the TS
// mirror in the same PR.
func TestVariantResolveCacheKeys(t *testing.T) {
	byName := map[string]imageproxy.Variant{}
	for _, v := range imageproxy.Variants {
		byName[v.Name] = v
	}

	cases := []struct {
		variant  string
		srcW     *int
		srcH     *int
		wantKey  string
		wantMIME string
	}{
		// Fixed variants ignore source dimensions entirely.
		{"search", nil, nil, "lib/file/transforms/w80_h80_q70.jpeg", "image/jpeg"},
		{"search", iptr(40), iptr(40), "lib/file/transforms/w80_h80_q70.jpeg", "image/jpeg"},
		{"timeline", iptr(50), iptr(50), "lib/file/transforms/w240_h240_q70.webp", "image/webp"},
		{"face", nil, nil, "lib/file/transforms/w300_h300_q80.jpeg", "image/jpeg"},
		// Capped variants clamp down to source size when smaller than the box.
		{"card", nil, nil, "lib/file/transforms/w720_h360_q82.jpeg", "image/jpeg"},
		{"card", iptr(5000), iptr(4000), "lib/file/transforms/w720_h360_q82.jpeg", "image/jpeg"},
		{"card", iptr(500), iptr(400), "lib/file/transforms/w500_h360_q82.jpeg", "image/jpeg"},
		{"preview", iptr(1000), iptr(800), "lib/file/transforms/w1000_h800_q90.jpeg", "image/jpeg"},
		{"preview", iptr(4000), iptr(3000), "lib/file/transforms/w1920_h1080_q90.jpeg", "image/jpeg"},
	}

	for _, c := range cases {
		v, ok := byName[c.variant]
		if !ok {
			t.Fatalf("variant %q missing from registry", c.variant)
		}
		opts := v.Resolve(c.srcW, c.srcH)
		gotKey := imageproxy.TransformCacheKey("lib", "file", opts)
		if gotKey != c.wantKey {
			t.Errorf("%s Resolve(%v,%v) key = %q, want %q", c.variant, c.srcW, c.srcH, gotKey, c.wantKey)
		}
		if gotMIME := imageproxy.MIMEForOpts(opts); gotMIME != c.wantMIME {
			t.Errorf("%s mime = %q, want %q", c.variant, gotMIME, c.wantMIME)
		}
	}
}

// TestVariantsRegistryStable pins the exact registry contents so an accidental
// edit (or a merge that drops a variant) is caught, and so VariantsVersion is
// bumped deliberately alongside any change.
func TestVariantsRegistryStable(t *testing.T) {
	want := []imageproxy.Variant{
		{Name: "search", MaxWidth: 80, MaxHeight: 80, Quality: 70, Format: "jpeg", Cap: false},
		{Name: "timeline", MaxWidth: 240, MaxHeight: 240, Quality: 70, Format: "webp", Cap: false},
		{Name: "face", MaxWidth: 300, MaxHeight: 300, Quality: 80, Format: "jpeg", Cap: false},
		{Name: "card", MaxWidth: 720, MaxHeight: 360, Quality: 82, Format: "jpeg", Cap: true},
		{Name: "preview", MaxWidth: 1920, MaxHeight: 1080, Quality: 90, Format: "jpeg", Cap: true},
	}
	if len(imageproxy.Variants) != len(want) {
		t.Fatalf("registry has %d variants, want %d — if intentional, update this test AND bump VariantsVersion AND the TS mirror", len(imageproxy.Variants), len(want))
	}
	for i, w := range want {
		if imageproxy.Variants[i] != w {
			t.Errorf("variant[%d] = %+v, want %+v", i, imageproxy.Variants[i], w)
		}
	}
	if imageproxy.VariantsVersion < 1 {
		t.Errorf("VariantsVersion = %d, want >= 1", imageproxy.VariantsVersion)
	}
}
