package metadata

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"

	goexif "github.com/rwcarlsen/goexif/exif"
)

// extracted holds the metadata pulled from a file. Every field is optional —
// absence is the common case (PNGs, stripped photos, videos with no GPS) and is
// never treated as a failure.
type extracted struct {
	CapturedAt  *time.Time
	GpsLat      *float64
	GpsLon      *float64
	CameraMake  *string
	CameraModel *string
}

// parseImageMetadata reads EXIF capture date, GPS and camera make/model from an
// image's bytes. It never returns an error: missing or malformed EXIF yields a
// zero-value result (graceful degradation). A defer/recover guards against the
// goexif decoder panicking on hostile input.
func parseImageMetadata(data []byte) (ex extracted) {
	defer func() {
		if r := recover(); r != nil {
			ex = extracted{}
		}
	}()

	x, err := goexif.Decode(bytes.NewReader(data))
	// goexif may return a partial *Exif alongside a non-critical error; if we
	// got nothing usable, there's simply no metadata to extract.
	if x == nil {
		_ = err
		return extracted{}
	}

	if dt, derr := x.DateTime(); derr == nil && !dt.IsZero() {
		t := dt
		ex.CapturedAt = &t
	}

	if lat, lon, lerr := x.LatLong(); lerr == nil && (lat != 0 || lon != 0) {
		la, lo := lat, lon
		ex.GpsLat = &la
		ex.GpsLon = &lo
	}

	ex.CameraMake = exifTagString(x, goexif.Make)
	ex.CameraModel = exifTagString(x, goexif.Model)
	return ex
}

// exifTagString returns a cleaned string value for a tag, or nil if absent/empty.
func exifTagString(x *goexif.Exif, field goexif.FieldName) *string {
	tag, err := x.Get(field)
	if err != nil || tag == nil {
		return nil
	}
	s, err := tag.StringVal()
	if err != nil {
		return nil
	}
	s = strings.TrimSpace(strings.Trim(s, "\x00"))
	if s == "" {
		return nil
	}
	return &s
}

// ffprobeOutput is the subset of `ffprobe -show_format -show_streams` JSON we read.
type ffprobeOutput struct {
	Format struct {
		Tags map[string]string `json:"tags"`
	} `json:"format"`
	Streams []struct {
		Tags map[string]string `json:"tags"`
	} `json:"streams"`
}

// parseProbeMetadata extracts capture time and GPS from ffprobe JSON. Returns a
// zero value when the relevant container tags are absent.
func parseProbeMetadata(out []byte) (ex extracted) {
	var probe ffprobeOutput
	if err := json.Unmarshal(out, &probe); err != nil {
		return extracted{}
	}

	// Collect tags from format first, then each stream, so format-level tags win.
	tagSets := []map[string]string{probe.Format.Tags}
	for _, s := range probe.Streams {
		tagSets = append(tagSets, s.Tags)
	}

	for _, tags := range tagSets {
		if ex.CapturedAt == nil {
			if t := parseProbeTime(tagLookup(tags, "creation_time")); t != nil {
				ex.CapturedAt = t
			}
		}
		if ex.GpsLat == nil {
			// Apple writes ISO-6709 under several keys; check the common ones.
			for _, key := range []string{"com.apple.quicktime.location.ISO6709", "location", "location-eng"} {
				if lat, lon, ok := parseISO6709(tagLookup(tags, key)); ok {
					la, lo := lat, lon
					ex.GpsLat = &la
					ex.GpsLon = &lo
					break
				}
			}
		}
	}
	return ex
}

// tagLookup does a case-insensitive lookup, since container tag casing varies.
func tagLookup(tags map[string]string, key string) string {
	if tags == nil {
		return ""
	}
	if v, ok := tags[key]; ok {
		return v
	}
	lower := strings.ToLower(key)
	for k, v := range tags {
		if strings.ToLower(k) == lower {
			return v
		}
	}
	return ""
}

var probeTimeLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02T15:04:05.000000Z",
	"2006-01-02 15:04:05",
	"2006-01-02T15:04:05",
}

func parseProbeTime(v string) *time.Time {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	for _, layout := range probeTimeLayouts {
		if t, err := time.Parse(layout, v); err == nil && !t.IsZero() {
			return &t
		}
	}
	return nil
}

// iso6709Re captures the first two signed decimals of an ISO-6709 string such as
// "+37.7858-122.4064+010.000/" → latitude, longitude (altitude is ignored).
var iso6709Re = regexp.MustCompile(`([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)`)

func parseISO6709(v string) (lat, lon float64, ok bool) {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0, 0, false
	}
	m := iso6709Re.FindStringSubmatch(v)
	if m == nil {
		return 0, 0, false
	}
	la, err1 := strconv.ParseFloat(m[1], 64)
	lo, err2 := strconv.ParseFloat(m[2], 64)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	if la == 0 && lo == 0 {
		return 0, 0, false
	}
	return la, lo, true
}
