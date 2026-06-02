package main

import (
	"testing"
)

func TestBuildCORSOrigins(t *testing.T) {
	cases := []struct {
		name         string
		baseURL      string
		extraOrigins []string
		env          string
		want         []string
	}{
		{
			name:    "production: only base URL origin",
			baseURL: "https://alcoves.example.com",
			env:     "production",
			want:    []string{"https://alcoves.example.com"},
		},
		{
			name:         "production: base URL + extras",
			baseURL:      "https://alcoves.example.com",
			extraOrigins: []string{"https://cdn.example.com"},
			env:          "production",
			want:         []string{"https://alcoves.example.com", "https://cdn.example.com"},
		},
		{
			name:    "development: adds localhost origins",
			baseURL: "http://localhost:3001",
			env:     "development",
			want:    []string{"http://localhost:3001", "http://localhost:3000", "http://localhost:5173"},
		},
		{
			name:    "development: base URL is localhost:3000, no duplicate",
			baseURL: "http://localhost:3000",
			env:     "development",
			want:    []string{"http://localhost:3000", "http://localhost:5173"},
		},
		{
			name:    "base URL with path: only scheme+host used",
			baseURL: "https://example.com/subpath",
			env:     "production",
			want:    []string{"https://example.com"},
		},
		{
			name:    "empty base URL: no entry added",
			baseURL: "",
			env:     "production",
			want:    []string{},
		},
		{
			name:    "evil origin not in allowlist",
			baseURL: "https://good.example.com",
			env:     "production",
			want:    []string{"https://good.example.com"},
		},
		{
			name:         "duplicate extras are deduplicated",
			baseURL:      "https://example.com",
			extraOrigins: []string{"https://example.com", "https://other.com"},
			env:          "production",
			want:         []string{"https://example.com", "https://other.com"},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := buildCORSOrigins(tc.baseURL, tc.extraOrigins, tc.env)
			if len(got) != len(tc.want) {
				t.Fatalf("buildCORSOrigins() = %v (len %d), want %v (len %d)",
					got, len(got), tc.want, len(tc.want))
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("[%d] got %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestBuildCORSOrigins_EvilOriginNotAllowed(t *testing.T) {
	origins := buildCORSOrigins("https://myapp.example.com", nil, "production")
	for _, o := range origins {
		if o == "https://evil.example.com" {
			t.Errorf("evil origin should not be in allowlist, got %v", origins)
		}
	}
}
