// Package onnxtest wires the onnxruntime_go bindings to a usable ONNX Runtime
// shared library before any session is loaded. It is split out of testsupport
// so that only the ML test packages (face/object/audio detection) pull in the
// onnxruntime_go cgo dependency; plain DB/handler tests keep importing
// testsupport without it.
package onnxtest

import (
	"os"
	"path/filepath"
	"sync"

	ort "github.com/yalue/onnxruntime_go"

	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

var once sync.Once

// SetupLib points onnxruntime_go at a shared library if one can be located.
// It is idempotent, safe to call from a test file's init(), and a no-op once
// ort.InitializeEnvironment has already run — so it MUST run before the first
// session load in the test binary (calling it from init() guarantees this).
//
// When no library is found it leaves onnxruntime_go's default ("onnxruntime.so")
// in place, which the dynamic loader resolves on Linux/CI where
// libonnxruntime.so is installed. Real-inference tests still skip when the
// subsequent session load fails, so a host without a working (and
// API-compatible) ONNX Runtime degrades to skipped tests rather than failures.
//
// Resolution order:
//  1. $ALCOVES_ONNXRUNTIME_LIB                      — explicit override
//  2. <repo>/data/.ort/onnxruntime-*/lib/lib...     — developer-local matched build
//  3. common system locations                        — /usr/local/lib, homebrew
func SetupLib() {
	once.Do(func() {
		if p := resolveLib(); p != "" {
			ort.SetSharedLibraryPath(p)
		}
	})
}

func resolveLib() string {
	if p := os.Getenv("ALCOVES_ONNXRUNTIME_LIB"); p != "" {
		return p
	}
	if root := testsupport.RepoRoot(); root != "" {
		matches, _ := filepath.Glob(filepath.Join(root, "data", ".ort", "onnxruntime-*", "lib"))
		for _, libDir := range matches {
			for _, base := range []string{"libonnxruntime.dylib", "libonnxruntime.so"} {
				if c := filepath.Join(libDir, base); testsupport.FileExists(c) {
					return c
				}
			}
		}
	}
	for _, c := range []string{
		"/usr/local/lib/onnxruntime.so",
		"/usr/local/lib/libonnxruntime.so",
		"/opt/homebrew/lib/libonnxruntime.dylib",
		"/usr/local/lib/libonnxruntime.dylib",
	} {
		if testsupport.FileExists(c) {
			return c
		}
	}
	return ""
}
