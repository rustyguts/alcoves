// Package version exposes the build-time git revision so the frontend can
// link back to the exact commit the running binary was built from.
//
// Resolution order on each call:
//  1. The `commit` / `buildTime` package vars set via `-ldflags "-X ..."` at
//     `go build` time. Used by container images and release builds.
//  2. `runtime/debug.ReadBuildInfo()` `vcs.revision` / `vcs.time` settings
//     that the Go toolchain embeds when building from a git checkout. Used
//     by `go build` / Air dev runs without explicit ldflags.
//  3. Empty string. Frontend treats that as "unknown" and skips the link.
package version

import (
	"runtime/debug"
	"sync"
)

// Overridable at link time:
//
//	go build -ldflags "-X github.com/alcoves/alcoves-backend/internal/version.commit=$(git rev-parse HEAD) \
//	                   -X github.com/alcoves/alcoves-backend/internal/version.buildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
//	                   -X github.com/alcoves/alcoves-backend/internal/version.appVersion=$(cat VERSION)"
//
// `appVersion` is the human-readable semver from /VERSION at the repo root.
// When unset (e.g. `go run` during local dev) App() returns "dev".
var (
	commit     string
	buildTime  string
	appVersion string
)

var (
	once         sync.Once
	resolvedSHA  string
	resolvedTime string
	dirty        bool
)

func resolve() {
	once.Do(func() {
		resolvedSHA = commit
		resolvedTime = buildTime
		info, ok := debug.ReadBuildInfo()
		if !ok {
			return
		}
		for _, s := range info.Settings {
			switch s.Key {
			case "vcs.revision":
				if resolvedSHA == "" {
					resolvedSHA = s.Value
				}
			case "vcs.time":
				if resolvedTime == "" {
					resolvedTime = s.Value
				}
			case "vcs.modified":
				if s.Value == "true" {
					dirty = true
				}
			}
		}
	})
}

// Commit returns the full git SHA the binary was built from, or "" if the
// build did not embed VCS info (e.g. `go run` outside a git tree).
func Commit() string {
	resolve()
	return resolvedSHA
}

// BuildTime returns the commit timestamp (RFC 3339) when available.
func BuildTime() string {
	resolve()
	return resolvedTime
}

// Dirty reports whether the working tree had uncommitted changes at build
// time. Useful for flagging dev builds in the UI.
func Dirty() bool {
	resolve()
	return dirty
}

// App returns the human-readable semver embedded at build time (from the
// repo-root VERSION file). Returns "dev" when not set, e.g. `go run` outside
// a release build.
func App() string {
	if appVersion == "" {
		return "dev"
	}
	return appVersion
}
