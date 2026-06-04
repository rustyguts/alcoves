package metadata

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"testing"
)

func TestParseISO6709(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		wantLat float64
		wantLon float64
		wantOK  bool
	}{
		{"apple with altitude", "+37.7858-122.4064+010.000/", 37.7858, -122.4064, true},
		{"no altitude", "+37.7858-122.4064/", 37.7858, -122.4064, true},
		{"both negative", "-33.8688-151.2093/", -33.8688, -151.2093, true},
		{"positive lon", "+51.5074+000.1278/", 51.5074, 0.1278, true},
		{"empty", "", 0, 0, false},
		{"garbage", "not-a-coordinate", 0, 0, false},
		{"null island ignored", "+0.0+0.0/", 0, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			lat, lon, ok := parseISO6709(c.in)
			if ok != c.wantOK {
				t.Fatalf("ok = %v, want %v", ok, c.wantOK)
			}
			if !ok {
				return
			}
			if math.Abs(lat-c.wantLat) > 1e-6 || math.Abs(lon-c.wantLon) > 1e-6 {
				t.Fatalf("got (%f, %f), want (%f, %f)", lat, lon, c.wantLat, c.wantLon)
			}
		})
	}
}

func TestParseProbeMetadata(t *testing.T) {
	t.Run("creation_time and apple location", func(t *testing.T) {
		j := []byte(`{
			"format": {"tags": {
				"creation_time": "2021-08-15T14:30:00.000000Z",
				"com.apple.quicktime.location.ISO6709": "+40.7128-074.0060+010.000/"
			}},
			"streams": []
		}`)
		ex := parseProbeMetadata(j)
		if ex.CapturedAt == nil {
			t.Fatal("expected capturedAt")
		}
		if ex.CapturedAt.Year() != 2021 || ex.CapturedAt.Month() != 8 || ex.CapturedAt.Day() != 15 {
			t.Fatalf("unexpected date: %v", ex.CapturedAt)
		}
		if ex.GpsLat == nil || ex.GpsLon == nil {
			t.Fatal("expected gps")
		}
		if math.Abs(*ex.GpsLat-40.7128) > 1e-6 || math.Abs(*ex.GpsLon-(-74.0060)) > 1e-6 {
			t.Fatalf("gps = (%v, %v)", *ex.GpsLat, *ex.GpsLon)
		}
	})

	t.Run("plain location tag, RFC3339 time", func(t *testing.T) {
		j := []byte(`{"format": {"tags": {
			"creation_time": "2019-01-02T03:04:05Z",
			"location": "-33.8688+151.2093/"
		}}}`)
		ex := parseProbeMetadata(j)
		if ex.GpsLat == nil || math.Abs(*ex.GpsLat-(-33.8688)) > 1e-6 {
			t.Fatalf("lat = %v", ex.GpsLat)
		}
		if ex.CapturedAt == nil || ex.CapturedAt.Year() != 2019 {
			t.Fatalf("date = %v", ex.CapturedAt)
		}
	})

	t.Run("falls back to stream creation_time", func(t *testing.T) {
		j := []byte(`{"format": {"tags": {}}, "streams": [{"tags": {"creation_time": "2020-05-05T00:00:00Z"}}]}`)
		ex := parseProbeMetadata(j)
		if ex.CapturedAt == nil || ex.CapturedAt.Year() != 2020 {
			t.Fatalf("date = %v", ex.CapturedAt)
		}
		if ex.GpsLat != nil {
			t.Fatal("expected no gps")
		}
	})

	t.Run("no metadata", func(t *testing.T) {
		ex := parseProbeMetadata([]byte(`{"format": {"tags": {}}}`))
		if ex.CapturedAt != nil || ex.GpsLat != nil {
			t.Fatal("expected empty result")
		}
	})

	t.Run("invalid json degrades", func(t *testing.T) {
		ex := parseProbeMetadata([]byte(`not json`))
		if ex.CapturedAt != nil || ex.GpsLat != nil {
			t.Fatal("expected empty result")
		}
	})
}

func TestParseImageMetadata_NoExif(t *testing.T) {
	t.Run("valid jpeg without exif", func(t *testing.T) {
		img := image.NewRGBA(image.Rect(0, 0, 2, 2))
		img.Set(0, 0, color.RGBA{R: 255, A: 255})
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, img, nil); err != nil {
			t.Fatal(err)
		}
		ex := parseImageMetadata(buf.Bytes())
		if ex.CapturedAt != nil || ex.GpsLat != nil || ex.CameraMake != nil {
			t.Fatalf("expected empty result, got %+v", ex)
		}
	})

	t.Run("random bytes do not panic", func(t *testing.T) {
		ex := parseImageMetadata([]byte{0x00, 0x01, 0x02, 0xff, 0xd8, 0xff, 0x99, 0x42})
		if ex.CapturedAt != nil || ex.GpsLat != nil {
			t.Fatalf("expected empty result, got %+v", ex)
		}
	})
}

func TestParseImageMetadata_WithExif(t *testing.T) {
	data := buildExifJPEG()
	ex := parseImageMetadata(data)

	if ex.CapturedAt == nil {
		t.Fatal("expected capturedAt from DateTimeOriginal")
	}
	if ex.CapturedAt.Year() != 2020 || ex.CapturedAt.Month() != 6 || ex.CapturedAt.Day() != 1 {
		t.Fatalf("unexpected captured date: %v", ex.CapturedAt)
	}
	if ex.GpsLat == nil || ex.GpsLon == nil {
		t.Fatal("expected GPS coordinates")
	}
	// 37°46'30\"N = 37.775, 122°25'12\"W = -122.42
	if math.Abs(*ex.GpsLat-37.775) > 1e-3 {
		t.Fatalf("lat = %v, want ~37.775", *ex.GpsLat)
	}
	if math.Abs(*ex.GpsLon-(-122.42)) > 1e-3 {
		t.Fatalf("lon = %v, want ~-122.42", *ex.GpsLon)
	}
	if ex.CameraMake == nil || *ex.CameraMake != "TestCam" {
		t.Fatalf("make = %v, want TestCam", ex.CameraMake)
	}
	if ex.CameraModel == nil || *ex.CameraModel != "Model1" {
		t.Fatalf("model = %v, want Model1", ex.CameraModel)
	}
}

// buildExifJPEG constructs a minimal JPEG carrying an EXIF APP1 segment with
// Make, Model, DateTimeOriginal and GPS lat/lon, exercising the image path
// without an external fixture file. Little-endian ("II") TIFF.
func buildExifJPEG() []byte {
	const (
		tagMake        = 0x010F
		tagModel       = 0x0110
		tagDateTime    = 0x0132
		tagExifPointer = 0x8769
		tagGPSPointer  = 0x8825
		tagDTOriginal  = 0x9003

		gpsLatRef = 0x0001
		gpsLat    = 0x0002
		gpsLonRef = 0x0003
		gpsLon    = 0x0004

		typeASCII    = 2
		typeLong     = 4
		typeRational = 5
	)

	makeStr := []byte("TestCam\x00")            // 8
	modelStr := []byte("Model1\x00")            // 7
	dtStr := []byte("2020:06:01 10:00:00\x00")  // 20
	dtoStr := []byte("2020:06:01 10:00:00\x00") // 20

	// IFD layout (offsets relative to TIFF start):
	// 0:  header (8 bytes) -> IFD0 at 8
	// 8:  IFD0  (2 + 5*12 + 4 = 66) -> ends 74
	// 74: Exif sub-IFD (2 + 1*12 + 4 = 18) -> ends 92
	// 92: GPS sub-IFD (2 + 4*12 + 4 = 54) -> ends 146
	// 146: data area
	const exifIFDOff = 74
	const gpsIFDOff = 92
	dataOff := 146
	makeOff := dataOff
	modelOff := makeOff + len(makeStr)
	dtOff := modelOff + len(modelStr)
	dtoOff := dtOff + len(dtStr)
	latOff := dtoOff + len(dtoStr)
	lonOff := latOff + 24 // 3 rationals * 8

	var tiff bytes.Buffer
	le := binary.LittleEndian
	w16 := func(v uint16) { _ = binary.Write(&tiff, le, v) }
	w32 := func(v uint32) { _ = binary.Write(&tiff, le, v) }
	entry := func(tag, typ uint16, count uint32, valueOrOffset uint32) {
		w16(tag)
		w16(typ)
		w32(count)
		w32(valueOrOffset)
	}
	asciiInline := func(s string) uint32 {
		b := make([]byte, 4)
		copy(b, s)
		return le.Uint32(b)
	}

	// Header
	tiff.WriteString("II")
	w16(0x002A)
	w32(8)

	// IFD0 (5 entries)
	w16(5)
	entry(tagMake, typeASCII, uint32(len(makeStr)), uint32(makeOff))
	entry(tagModel, typeASCII, uint32(len(modelStr)), uint32(modelOff))
	entry(tagDateTime, typeASCII, uint32(len(dtStr)), uint32(dtOff))
	entry(tagExifPointer, typeLong, 1, exifIFDOff)
	entry(tagGPSPointer, typeLong, 1, gpsIFDOff)
	w32(0) // next IFD

	// Exif sub-IFD (1 entry)
	w16(1)
	entry(tagDTOriginal, typeASCII, uint32(len(dtoStr)), uint32(dtoOff))
	w32(0)

	// GPS sub-IFD (4 entries)
	w16(4)
	entry(gpsLatRef, typeASCII, 2, asciiInline("N"))
	entry(gpsLat, typeRational, 3, uint32(latOff))
	entry(gpsLonRef, typeASCII, 2, asciiInline("W"))
	entry(gpsLon, typeRational, 3, uint32(lonOff))
	w32(0)

	// Data area (must be written in offset order)
	tiff.Write(makeStr)
	tiff.Write(modelStr)
	tiff.Write(dtStr)
	tiff.Write(dtoStr)
	// GPS latitude 37/1, 46/1, 30/1
	for _, n := range []uint32{37, 46, 30} {
		w32(n)
		w32(1)
	}
	// GPS longitude 122/1, 25/1, 12/1
	for _, n := range []uint32{122, 25, 12} {
		w32(n)
		w32(1)
	}

	// Wrap TIFF in a JPEG APP1 segment.
	exif := append([]byte("Exif\x00\x00"), tiff.Bytes()...)
	var out bytes.Buffer
	out.Write([]byte{0xFF, 0xD8}) // SOI
	out.Write([]byte{0xFF, 0xE1}) // APP1
	segLen := len(exif) + 2
	out.WriteByte(byte(segLen >> 8))
	out.WriteByte(byte(segLen & 0xFF))
	out.Write(exif)
	out.Write([]byte{0xFF, 0xD9}) // EOI
	return out.Bytes()
}
