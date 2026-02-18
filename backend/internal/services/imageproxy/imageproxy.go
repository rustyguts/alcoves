package imageproxy

import (
	"fmt"

	"github.com/davidbyttow/govips/v2/vips"
)

// TransformOptions describes the desired image transformation.
type TransformOptions struct {
	Width   int    // Target width (0 = no width constraint)
	Height  int    // Target height (0 = no height constraint)
	Quality int    // Output quality 1-100 (0 = default 80)
	Format  string // Output format: "jpeg", "webp", "avif", "png" (empty = "jpeg")
}

// Processor transforms raw image bytes according to TransformOptions.
type Processor interface {
	// Transform processes srcData and returns the transformed image bytes and MIME type.
	Transform(srcData []byte, opts TransformOptions) ([]byte, string, error)
}

// VipsProcessor implements Processor using libvips via govips.
type VipsProcessor struct{}

// NewVipsProcessor returns a new VipsProcessor.
func NewVipsProcessor() *VipsProcessor {
	return &VipsProcessor{}
}

// Transform loads srcData into libvips, resizes to fit within opts.Width/Height
// (maintaining aspect ratio), encodes to the requested format/quality, and
// returns the resulting bytes and MIME type.
func (p *VipsProcessor) Transform(srcData []byte, opts TransformOptions) ([]byte, string, error) {
	img, err := vips.NewImageFromBuffer(srcData)
	if err != nil {
		return nil, "", fmt.Errorf("failed to load image: %w", err)
	}
	defer img.Close()

	// Apply EXIF rotation so the output matches the intended orientation.
	if err := img.AutoRotate(); err != nil {
		return nil, "", fmt.Errorf("failed to auto-rotate image: %w", err)
	}

	// Resize to fit within requested dimensions (maintain aspect ratio).
	if opts.Width > 0 || opts.Height > 0 {
		origW := float64(img.Width())
		origH := float64(img.Height())

		scale := 1.0
		if opts.Width > 0 && opts.Height > 0 {
			scaleW := float64(opts.Width) / origW
			scaleH := float64(opts.Height) / origH
			scale = scaleW
			if scaleH < scaleW {
				scale = scaleH
			}
		} else if opts.Width > 0 {
			scale = float64(opts.Width) / origW
		} else {
			scale = float64(opts.Height) / origH
		}

		// Only downscale, never upscale.
		if scale < 1.0 {
			if err := img.Resize(scale, vips.KernelLinear); err != nil {
				return nil, "", fmt.Errorf("failed to resize image: %w", err)
			}
		}
	}

	quality := opts.Quality
	if quality <= 0 {
		quality = 80
	}

	format := opts.Format
	if format == "" {
		format = "jpeg"
	}

	var outBytes []byte
	var mime string

	switch format {
	case "webp":
		params := vips.NewWebpExportParams()
		params.Quality = quality
		params.StripMetadata = true
		outBytes, _, err = img.ExportWebp(params)
		mime = "image/webp"
	case "avif":
		params := vips.NewAvifExportParams()
		params.Quality = quality
		params.StripMetadata = true
		outBytes, _, err = img.ExportAvif(params)
		mime = "image/avif"
	case "png":
		params := vips.NewPngExportParams()
		params.StripMetadata = true
		outBytes, _, err = img.ExportPng(params)
		mime = "image/png"
	default: // jpeg
		params := vips.NewJpegExportParams()
		params.Quality = quality
		params.Interlace = true
		params.StripMetadata = true
		params.OptimizeCoding = true
		outBytes, _, err = img.ExportJpeg(params)
		mime = "image/jpeg"
	}

	if err != nil {
		return nil, "", fmt.Errorf("failed to export image as %s: %w", format, err)
	}

	return outBytes, mime, nil
}

// NeedsTransform returns true if the options request any image processing.
func NeedsTransform(opts TransformOptions) bool {
	return opts.Width > 0 || opts.Height > 0 || opts.Quality > 0 || (opts.Format != "" && opts.Format != "jpeg")
}
