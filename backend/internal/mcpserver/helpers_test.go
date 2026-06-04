package mcpserver

import (
	"io"
	"net/url"
	"strings"
)

func stringReader(s string) io.Reader { return strings.NewReader(s) }

// tokenFromURL extracts the ?token= query value from a minted signed URL.
func tokenFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Query().Get("token")
}
