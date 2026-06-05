package jobreaper

import (
	"testing"

	"github.com/alcoves/alcoves-backend/internal/services/audiodetection"
	"github.com/alcoves/alcoves-backend/internal/services/momentexport"
	"github.com/alcoves/alcoves-backend/internal/services/transcribe"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
	"github.com/alcoves/alcoves-backend/internal/services/waveform"
)

// TestTaskTypeConstantsInSync locks the reaper's locally-mirrored task-type wire
// strings to their canonical definitions in the worker service packages. The
// reaper matches live tasks by these strings, so a silent rename in a worker
// package would otherwise make the reaper stop sparing in-flight jobs of that
// type. If this fails, update the mirrored const in reaper.go to match.
func TestTaskTypeConstantsInSync(t *testing.T) {
	cases := []struct {
		name      string
		local     string
		canonical string
	}{
		{"transcribe", taskTranscribe, transcribe.TaskTypeTranscribe},
		{"video-proxy", taskVideoProxy, videoproxy.TaskTypeVideoProxy},
		{"audio-detect", taskAudioDetect, audiodetection.TaskTypeAudioDetect},
		{"waveform", taskWaveform, waveform.TaskTypeWaveform},
		{"moment-export", taskMomentExport, momentexport.TaskTypeMomentExport},
	}
	for _, c := range cases {
		if c.local != c.canonical {
			t.Errorf("%s: reaper const %q != canonical %q", c.name, c.local, c.canonical)
		}
	}
}

// TestSpecsCoverDistinctTaskTypes guards against a copy-paste slip that points
// two specs at the same task type or leaves a payload id field blank.
func TestSpecsCoverDistinctTaskTypes(t *testing.T) {
	seen := map[string]bool{}
	for _, sp := range specs {
		if sp.taskType == "" || sp.payloadIDField == "" || sp.statusColumn == "" || sp.table == "" {
			t.Errorf("spec %q has an empty required field: %+v", sp.name, sp)
		}
		if seen[sp.taskType] {
			t.Errorf("duplicate spec for task type %q", sp.taskType)
		}
		seen[sp.taskType] = true
	}
}
