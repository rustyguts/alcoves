package version

import (
	"sync"
	"testing"
)

// resetResolve resets the sync.Once-guarded resolution state so individual
// tests can control the package vars and observe the resolution result. This
// mutates unexported package state directly (white-box test).
func resetResolve() {
	once = sync.Once{}
	resolvedSHA = ""
	resolvedTime = ""
	dirty = false
}

func TestApp_DefaultsToDev(t *testing.T) {
	// appVersion is unset by default (no ldflags during `go test`).
	if got := App(); got != "dev" {
		t.Errorf("App() = %q, want %q", got, "dev")
	}
}

func TestApp_ReturnsSetVersion(t *testing.T) {
	prev := appVersion
	t.Cleanup(func() { appVersion = prev })

	appVersion = "1.2.3"
	if got := App(); got != "1.2.3" {
		t.Errorf("App() = %q, want %q", got, "1.2.3")
	}
}

func TestCommit_UsesLdflagOverride(t *testing.T) {
	prevCommit := commit
	t.Cleanup(func() {
		commit = prevCommit
		resetResolve()
		resolve() // re-resolve real state for any later callers
	})

	resetResolve()
	commit = "deadbeefcafe"
	if got := Commit(); got != "deadbeefcafe" {
		t.Errorf("Commit() = %q, want ldflag override %q", got, "deadbeefcafe")
	}
}

func TestBuildTime_UsesLdflagOverride(t *testing.T) {
	prevTime := buildTime
	t.Cleanup(func() {
		buildTime = prevTime
		resetResolve()
		resolve()
	})

	resetResolve()
	buildTime = "2026-01-02T03:04:05Z"
	if got := BuildTime(); got != "2026-01-02T03:04:05Z" {
		t.Errorf("BuildTime() = %q, want ldflag override %q", got, "2026-01-02T03:04:05Z")
	}
}

// TestResolveFromBuildInfo exercises the debug.ReadBuildInfo fallback path:
// with no ldflag overrides, Commit/BuildTime should be populated from the
// embedded VCS info (when present) or empty (when not). Either way the call
// must not panic and the getters must be stable across calls.
func TestResolveFromBuildInfo(t *testing.T) {
	prevCommit, prevTime := commit, buildTime
	t.Cleanup(func() {
		commit, buildTime = prevCommit, prevTime
		resetResolve()
		resolve()
	})

	resetResolve()
	commit = ""
	buildTime = ""

	sha := Commit()
	bt := BuildTime()
	_ = Dirty() // exercise the getter

	if Commit() != sha {
		t.Errorf("Commit() not stable across calls: %q vs %q", Commit(), sha)
	}
	if BuildTime() != bt {
		t.Errorf("BuildTime() not stable across calls: %q vs %q", BuildTime(), bt)
	}
}

func TestDirty_ReturnsBool(t *testing.T) {
	// Smoke: Dirty() must resolve and return without panicking.
	_ = Dirty()
}
