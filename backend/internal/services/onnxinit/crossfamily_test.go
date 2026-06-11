package onnxinit_test

import (
	"testing"

	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// TestCrossFamilySessionsShareOneRuntimeInit is the regression test for the
// per-package ONNX init bug: facedetection, objectdetection, and
// audiodetection each guarded the process-global ort.InitializeEnvironment()
// with their own package-level sync.Once. In one process the first family to
// load worked and every other family got "the onnxruntime has already been
// initialized" — and cached that error until restart, silently breaking the
// other detectors in ALCOVES_MODE=all/worker.
//
// It loads real sessions from two different families in the same test binary
// and asserts the SECOND one succeeds. It skips cleanly (same convention as
// the realinference tests) when the ONNX Runtime or model weights are
// unavailable.
func TestCrossFamilySessionsShareOneRuntimeInit(t *testing.T) {
	models := testsupport.ModelsCacheDir()

	// Family 1: face detection. Runtime/weights availability is a host
	// concern, not the regression — skip if it can't come up at all.
	det, err := facedetection.LoadDetectionSession(models)
	if err != nil {
		t.Skipf("face detection model/runtime unavailable: %v", err)
	}
	defer det.Destroy()

	// Family 2's weights are a network concern, not an init concern — skip
	// (don't fail) if they can't be fetched.
	if err := objectdetection.EnsureModelsDownloaded(models); err != nil {
		t.Skipf("object detection model unavailable: %v", err)
	}

	// Family 2: the regression. With per-package init guards this failed with
	// "the onnxruntime has already been initialized".
	sess, err := objectdetection.LoadDetectionSession(models)
	if err != nil {
		t.Fatalf("second ML family failed to load a session after facedetection initialized ONNX: %v", err)
	}
	defer sess.Destroy()
}
