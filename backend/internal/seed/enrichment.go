package seed

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/momentexport"
)

// --- faces & people --------------------------------------------------------

func (s *seeder) createPerson(idName string, lib uuid.UUID, name *string, createdAt time.Time) *models.Person {
	if s.err != nil {
		return &models.Person{}
	}
	p := &models.Person{
		ID:        id(idName),
		LibraryID: lib,
		Name:      name,
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}
	s.create(p)
	if s.err == nil {
		s.res.People++
	}
	return p
}

// addFace inserts a face detection (embedding left NULL — recognition is
// fixture data here) and writes its crop to the cache so the people UI can show
// the face. box is [x, y, w, h] in source-image pixels.
func (s *seeder) addFace(idName string, file *models.File, lib uuid.UUID, person *uuid.UUID, box [4]int, confidence int, cropAsset string) *models.FaceDetection {
	if s.err != nil {
		return &models.FaceDetection{}
	}
	imgW, imgH := 1024, 768
	if file.Width != nil {
		imgW = *file.Width
	}
	if file.Height != nil {
		imgH = *file.Height
	}
	fd := &models.FaceDetection{
		ID:           id(idName),
		FileID:       file.ID,
		LibraryID:    lib,
		PersonID:     person,
		BoxX:         box[0],
		BoxY:         box[1],
		BoxWidth:     box[2],
		BoxHeight:    box[3],
		ImageWidth:   imgW,
		ImageHeight:  imgH,
		Confidence:   confidence,
		QualityScore: ip(confidence),
		CreatedAt:    file.CreatedAt,
	}
	s.create(fd)
	if s.err == nil {
		s.res.Faces++
		crop, cerr := asset(cropAsset)
		if cerr != nil {
			s.fail(cerr)
			return fd
		}
		if serr := s.st.StoreCacheBuffer(fmt.Sprintf("%s/faces/%s.webp", lib.String(), fd.ID.String()), crop); serr != nil {
			s.fail(fmt.Errorf("store face crop %s: %w", idName, serr))
			return fd
		}
	}
	return fd
}

// setPersonCover points a person at a cover face and sets its face count. Done
// after faces exist to avoid the person<->face circular reference at insert.
func (s *seeder) setPersonCover(person, cover uuid.UUID, faceCount int) {
	if s.err != nil {
		return
	}
	if err := s.db.Model(&models.Person{}).Where("id = ?", person).
		Updates(map[string]any{"cover_face_detection_id": cover, "face_count": faceCount}).Error; err != nil {
		s.fail(fmt.Errorf("set person cover: %w", err))
	}
}

// --- object detections -----------------------------------------------------

func (s *seeder) addObject(idName string, file *models.File, lib uuid.UUID, label string, confidence int, box [4]int) {
	if s.err != nil {
		return
	}
	imgW, imgH := 1024, 768
	if file.Width != nil {
		imgW = *file.Width
	}
	if file.Height != nil {
		imgH = *file.Height
	}
	s.create(&models.ObjectDetection{
		ID:          id(idName),
		FileID:      file.ID,
		LibraryID:   lib,
		Label:       label,
		Confidence:  confidence,
		BoxX:        box[0],
		BoxY:        box[1],
		BoxWidth:    box[2],
		BoxHeight:   box[3],
		ImageWidth:  imgW,
		ImageHeight: imgH,
		CreatedAt:   file.CreatedAt,
	})
	if s.err == nil {
		s.res.Objects++
	}
}

// --- moments & shares ------------------------------------------------------

func (s *seeder) addMoment(idName string, file *models.File, lib, creator uuid.UUID, name, desc string, start, end float64, createdAt time.Time) *models.Moment {
	if s.err != nil {
		return &models.Moment{}
	}
	m := &models.Moment{
		ID:            id(idName),
		FileID:        file.ID,
		LibraryID:     lib,
		CreatedByID:   creator,
		Name:          name,
		Description:   desc,
		StartSeconds:  start,
		EndSeconds:    end,
		ExportVersion: 1,
		CreatedAt:     createdAt,
		UpdatedAt:     createdAt,
	}
	s.create(m)
	if s.err == nil {
		s.res.Moments++
	}
	return m
}

// exportAndShare marks a moment as exported (writing a clip blob to the cache at
// the key the share endpoint streams from) and creates a public share link.
// For dev the exported clip is just the source video bytes — playable + enough
// to exercise the share landing page, OG tags, and SSR.
func (s *seeder) exportAndShare(m *models.Moment, lib, creator uuid.UUID, clipAsset, shareToken, shareIDName string) {
	if s.err != nil {
		return
	}
	clip, err := asset(clipAsset)
	if err != nil {
		s.fail(err)
		return
	}
	cacheKey := momentexport.CacheKey(lib.String(), m.ID.String(), 1)
	if serr := s.st.StoreCacheBuffer(cacheKey, clip); serr != nil {
		s.fail(fmt.Errorf("store moment clip: %w", serr))
		return
	}
	if uerr := s.db.Model(&models.Moment{}).Where("id = ?", m.ID).Updates(map[string]any{
		"export_status":    "ready",
		"export_version":   1,
		"exported_version": 1,
		"export_progress":  100,
	}).Error; uerr != nil {
		s.fail(fmt.Errorf("update moment export: %w", uerr))
		return
	}
	s.create(&models.MomentShare{
		ID:          id(shareIDName),
		MomentID:    m.ID,
		LibraryID:   lib,
		CreatedByID: creator,
		Token:       shareToken,
		CreatedAt:   m.CreatedAt,
	})
}

// --- highlight filters -----------------------------------------------------

func (s *seeder) addHighlightFilter(idName string, lib uuid.UUID, creator *uuid.UUID, name, expr, color string, proximity int, createdAt time.Time) {
	s.create(&models.HighlightFilter{
		ID:               id(idName),
		LibraryID:        lib,
		CreatedByID:      creator,
		Name:             name,
		Expression:       expr,
		ProximitySeconds: proximity,
		Color:            color,
		CreatedAt:        createdAt,
		UpdatedAt:        createdAt,
	})
}

// --- audio detections ------------------------------------------------------

func (s *seeder) addAudioDetection(idName string, file *models.File, lib uuid.UUID, label string, classIndex int, score, start, end float32) {
	s.create(&models.AudioDetection{
		ID:           id(idName),
		FileID:       file.ID,
		LibraryID:    lib,
		Label:        label,
		ClassIndex:   classIndex,
		Score:        score,
		StartSeconds: start,
		EndSeconds:   end,
		Version:      1,
		CreatedAt:    file.CreatedAt,
	})
}

// --- transcripts -----------------------------------------------------------

func (s *seeder) setTranscript(file *models.File, text, vtt, model string) {
	if s.err != nil {
		return
	}
	if err := s.db.Model(&models.File{}).Where("id = ?", file.ID).Updates(map[string]any{
		"transcript_text":     text,
		"transcript_vtt":      vtt,
		"transcript_model":    model,
		"transcribe_status":   "ready",
		"transcribe_version":  1,
		"transcribed_version": 1,
	}).Error; err != nil {
		s.fail(fmt.Errorf("set transcript: %w", err))
	}
}

// --- waveforms -------------------------------------------------------------

// addWaveform writes a synthetic waveform JSON to the cache (matching the
// worker's shape) and flags the file so the player renders the scrubber.
func (s *seeder) addWaveform(file *models.File, lib uuid.UUID, duration int) {
	if s.err != nil {
		return
	}
	const peaksPerSecond = 50
	n := duration * peaksPerSecond
	if n <= 0 {
		n = peaksPerSecond
	}
	peaks := make([]float64, n)
	for i := range peaks {
		// A smooth, deterministic envelope so the waveform looks like speech.
		t := float64(i)
		v := 0.45 + 0.4*math.Abs(math.Sin(t/9)) + 0.1*math.Sin(t/2.3)
		peaks[i] = math.Min(1, math.Max(0.03, v))
	}
	payload, _ := json.Marshal(map[string]any{
		"peaks":          peaks,
		"peaksPerSecond": peaksPerSecond,
		"sampleRate":     16000,
	})
	cacheKey := fmt.Sprintf("%s/%s/waveform.json", lib.String(), file.ID.String())
	if err := s.st.StoreCacheBuffer(cacheKey, payload); err != nil {
		s.fail(fmt.Errorf("store waveform: %w", err))
		return
	}
	if err := s.db.Model(&models.File{}).Where("id = ?", file.ID).Updates(map[string]any{
		"waveform_status":           "ready",
		"waveform_version":          1,
		"waveformed_version":        1,
		"waveform_peaks_per_second": peaksPerSecond,
	}).Error; err != nil {
		s.fail(fmt.Errorf("flag waveform: %w", err))
	}
}

// --- activity feed ---------------------------------------------------------

func (s *seeder) addActivity(idName string, lib uuid.UUID, actor *uuid.UUID, action, subjectType string, subject *uuid.UUID, meta map[string]any, createdAt time.Time) {
	if s.err != nil {
		return
	}
	raw, _ := json.Marshal(meta)
	s.create(&models.LibraryActivity{
		ID:          id(idName),
		LibraryID:   lib,
		ActorID:     actor,
		Action:      action,
		SubjectType: subjectType,
		SubjectID:   subject,
		Metadata:    raw,
		CreatedAt:   createdAt,
	})
	if s.err == nil {
		s.res.Activities++
	}
}

// --- personal access tokens ------------------------------------------------

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *seeder) addPAT(idName string, user uuid.UUID, name, plaintext string, createdAt time.Time) {
	s.create(&models.PersonalAccessToken{
		ID:        id(idName),
		UserID:    user,
		TokenHash: hashToken(plaintext),
		Name:      name,
		CreatedAt: createdAt,
	})
}
