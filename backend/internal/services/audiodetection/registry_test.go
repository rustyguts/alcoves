package audiodetection

import "testing"

func TestRegistry_DefaultIsEfficientATmn10(t *testing.T) {
	// The default flipped from PANN CNN14 → EfficientAT mn10_as on the
	// 0.18 release. If a future change moves it, update both
	// settings.defaults() and docs/models.md in the same commit; this
	// test pins them in lockstep.
	if DefaultModelID != "efficientat_mn10" {
		t.Fatalf("DefaultModelID changed unexpectedly: %s", DefaultModelID)
	}
	if _, ok := Registry[DefaultModelID]; !ok {
		t.Fatalf("DefaultModelID %q not present in Registry", DefaultModelID)
	}
}

func TestRegistry_LegacyPANNStillSelectable(t *testing.T) {
	// PANN CNN14 must remain in the registry so admins can roll back
	// without a code change. Removing it requires a separate decision
	// (and an entry in docs/todos.md describing the rollback path).
	spec, ok := Registry["pann_cnn14"]
	if !ok {
		t.Fatal("pann_cnn14 must stay in the registry for rollback")
	}
	if spec.ModelFile != "panns_cnn14.onnx" {
		t.Errorf("pann_cnn14 model file: got %q want %q", spec.ModelFile, "panns_cnn14.onnx")
	}
	if spec.SampleRate != 32000 {
		t.Errorf("pann_cnn14 sample rate: got %d want 32000", spec.SampleRate)
	}
}

func TestLookupSpec_UnknownFallsBackToDefault(t *testing.T) {
	// A stale settings row (e.g. left over from a rolled-back deploy that
	// referenced a removed model) must not crash the worker — fall back
	// to the registry default so jobs continue running.
	spec, ok := LookupSpec("does_not_exist")
	if ok {
		t.Fatal("expected lookup miss for unknown ID")
	}
	if spec.ID != DefaultModelID {
		t.Fatalf("fallback ID: got %q want %q", spec.ID, DefaultModelID)
	}
}

func TestLookupSpec_EmptyIDReturnsDefault(t *testing.T) {
	spec, ok := LookupSpec("")
	if ok {
		t.Fatal("expected empty ID to be treated as miss")
	}
	if spec.ID != DefaultModelID {
		t.Fatalf("empty fallback ID: got %q", spec.ID)
	}
}

func TestIsValidModelID(t *testing.T) {
	for _, id := range []string{"pann_cnn14", "efficientat_mn04", "efficientat_mn10", "efficientat_mn40", "ced_tiny", "ced_small", "ced_base"} {
		if !IsValidModelID(id) {
			t.Errorf("IsValidModelID(%q) = false, want true", id)
		}
	}
	for _, id := range []string{"", "panns_cnn14", "wavegram", "BEATs", "ced", "mn10"} {
		if IsValidModelID(id) {
			t.Errorf("IsValidModelID(%q) = true, want false", id)
		}
	}
}

func TestModelList_DeterministicOrder(t *testing.T) {
	list := ModelList()
	if len(list) != len(Registry) {
		t.Fatalf("ModelList len = %d, Registry len = %d", len(list), len(Registry))
	}
	for i := 1; i < len(list); i++ {
		if list[i-1].ID > list[i].ID {
			t.Errorf("ModelList not sorted: %q after %q", list[i].ID, list[i-1].ID)
		}
	}
}

func TestRegistry_AllEntriesHaveValidSampleRate(t *testing.T) {
	// extractAudio passes spec.SampleRate to ffmpeg's `-ar` flag. A 0 or
	// negative value would produce a 32 kHz fallback that mismatches the
	// model's mel transform — guard at the registry level.
	for id, spec := range Registry {
		if spec.SampleRate != 16000 && spec.SampleRate != 32000 {
			t.Errorf("%s: unsupported SampleRate %d (expected 16000 or 32000)", id, spec.SampleRate)
		}
		if spec.ID != id {
			t.Errorf("%s: ModelSpec.ID = %q (map key mismatch)", id, spec.ID)
		}
		if spec.ModelFile == "" {
			t.Errorf("%s: ModelFile is empty", id)
		}
	}
}
