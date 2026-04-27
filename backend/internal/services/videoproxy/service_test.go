package videoproxy

import "testing"

func TestShouldCreateProxyByDefault(t *testing.T) {
	cases := []struct {
		name string
		mime string
		want bool
	}{
		{"empty mime defaults to proxy", "", true},
		{"mp4 needs no proxy", "video/mp4", false},
		{"webm needs no proxy", "video/webm", false},
		{"ogg needs no proxy", "video/ogg", false},
		{"mov needs proxy", "video/quicktime", true},
		{"mkv needs proxy", "video/x-matroska", true},
		{"avi needs proxy", "video/x-msvideo", true},
		{"trims whitespace", "  video/mp4  ", false},
		{"case-insensitive", "Video/MP4", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ShouldCreateProxyByDefault(tc.mime); got != tc.want {
				t.Errorf("ShouldCreateProxyByDefault(%q) = %v, want %v", tc.mime, got, tc.want)
			}
		})
	}
}
