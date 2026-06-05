// Package mediajobs centralizes the "reset a media-job's status columns on a
// File row, then enqueue the job" core shared by the proxy, waveform,
// transcribe, and audio-detection endpoints (both their single and bulk forms).
//
// Each job kind is an explicit named method — deliberately NOT a config table
// or boolean-flagged generic — so the per-kind column set, version semantics,
// and pre-steps stay readable and independently auditable. Callers keep their
// HTTP concerns (service-nil checks, mime/precondition validation, response
// building, status codes); these methods own only the DB reset + enqueue and
// the in-memory mutation of the passed *models.File so the caller's response
// reflects the new queued state.
//
// Errors are wrapped so the PHASE survives in the message ("update failed: …"
// vs "enqueue failed: …"). That fidelity is load-bearing: the bulk handlers
// surface err.Error() verbatim as the per-file skip reason.
package mediajobs

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/audiodetection"
	"github.com/alcoves/alcoves-backend/internal/services/transcribe"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
	"github.com/alcoves/alcoves-backend/internal/services/waveform"
)

// Service performs the reset+enqueue core for each media job kind.
type Service struct {
	db          *gorm.DB
	video       *videoproxy.Service
	waveform    *waveform.Service
	transcribe  *transcribe.Service
	audioDetect *audiodetection.Service
}

// NewService wires the underlying job services. Any of the job services may be
// nil; callers gate on their own service-nil checks before invoking the
// matching Trigger method, so these methods assume a non-nil dependency.
func NewService(db *gorm.DB, video *videoproxy.Service, waveform *waveform.Service, transcribe *transcribe.Service, audioDetect *audiodetection.Service) *Service {
	return &Service{
		db:          db,
		video:       video,
		waveform:    waveform,
		transcribe:  transcribe,
		audioDetect: audioDetect,
	}
}

// TriggerProxy expires any previous (non-trashed) proxy children, resets the
// proxy status columns, enqueues a forced video-proxy job, then mutates f.
// Proxy has no version and no error column.
func (s *Service) TriggerProxy(libraryID string, f *models.File) error {
	now := time.Now()

	// Expire previous proxies first so a regenerate doesn't leave stale
	// children playable. A failure here is treated as an update failure
	// (the handler historically returned a 500 for it).
	if err := s.db.Model(&models.File{}).
		Where("source_file_id = ? AND library_id = ? AND trashed_at IS NULL", f.ID, libraryID).
		Updates(map[string]interface{}{"trashed_at": now, "updated_at": now}).Error; err != nil {
		return fmt.Errorf("update failed: %w", err)
	}

	queued := "queued"
	zero := 0
	if err := s.db.Model(&models.File{}).
		Where("id = ?", f.ID).
		Updates(map[string]interface{}{
			"proxy_status":      queued,
			"proxy_progress":    zero,
			"proxy_eta_seconds": nil,
			"updated_at":        now,
		}).Error; err != nil {
		return fmt.Errorf("update failed: %w", err)
	}

	if err := s.video.EnqueueVideoProxy(libraryID, f.ID.String(), true); err != nil {
		return fmt.Errorf("enqueue failed: %w", err)
	}

	f.ProxyStatus = &queued
	f.ProxyProgress = &zero
	f.ProxyEtaSeconds = nil
	return nil
}

// TriggerWaveform resets the waveform status columns (status/progress/error,
// version+1; no eta), enqueues, then mutates f.
func (s *Service) TriggerWaveform(libraryID string, f *models.File) error {
	now := time.Now()
	queued := "queued"
	zero := 0
	newVersion := f.WaveformVersion + 1

	if err := s.db.Model(&models.File{}).
		Where("id = ?", f.ID).
		Updates(map[string]interface{}{
			"waveform_status":   queued,
			"waveform_progress": zero,
			"waveform_error":    nil,
			"waveform_version":  newVersion,
			"updated_at":        now,
		}).Error; err != nil {
		return fmt.Errorf("update failed: %w", err)
	}

	if err := s.waveform.EnqueueWaveform(libraryID, f.ID.String()); err != nil {
		return fmt.Errorf("enqueue failed: %w", err)
	}

	f.WaveformStatus = &queued
	f.WaveformProgress = &zero
	f.WaveformError = nil
	f.WaveformVersion = newVersion
	return nil
}

// TriggerTranscribe resets the transcribe status columns
// (status/progress/eta/error, version+1), enqueues, then mutates f.
func (s *Service) TriggerTranscribe(libraryID string, f *models.File) error {
	now := time.Now()
	queued := "queued"
	zero := 0
	newVersion := f.TranscribeVersion + 1

	if err := s.db.Model(&models.File{}).
		Where("id = ?", f.ID).
		Updates(map[string]interface{}{
			"transcribe_status":      queued,
			"transcribe_progress":    zero,
			"transcribe_eta_seconds": nil,
			"transcribe_error":       nil,
			"transcribe_version":     newVersion,
			"updated_at":             now,
		}).Error; err != nil {
		return fmt.Errorf("update failed: %w", err)
	}

	if err := s.transcribe.EnqueueTranscribe(libraryID, f.ID.String()); err != nil {
		return fmt.Errorf("enqueue failed: %w", err)
	}

	f.TranscribeStatus = &queued
	f.TranscribeProgress = &zero
	f.TranscribeEtaSeconds = nil
	f.TranscribeError = nil
	f.TranscribeVersion = newVersion
	return nil
}

// TriggerAudioDetect resets the audio-detect status columns
// (status/progress/eta/error, version+1), enqueues, then mutates f.
func (s *Service) TriggerAudioDetect(libraryID string, f *models.File) error {
	now := time.Now()
	queued := "queued"
	zero := 0
	newVersion := f.AudioDetectVersion + 1

	if err := s.db.Model(&models.File{}).
		Where("id = ?", f.ID).
		Updates(map[string]interface{}{
			"audio_detect_status":      queued,
			"audio_detect_progress":    zero,
			"audio_detect_eta_seconds": nil,
			"audio_detect_error":       nil,
			"audio_detect_version":     newVersion,
			"updated_at":               now,
		}).Error; err != nil {
		return fmt.Errorf("update failed: %w", err)
	}

	if err := s.audioDetect.EnqueueDetect(libraryID, f.ID.String()); err != nil {
		return fmt.Errorf("enqueue failed: %w", err)
	}

	f.AudioDetectStatus = &queued
	f.AudioDetectProgress = &zero
	f.AudioDetectEtaSeconds = nil
	f.AudioDetectError = nil
	f.AudioDetectVersion = newVersion
	return nil
}
