package seed

import (
	"strings"
	"time"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

// seedPodcast fills "Podcast Recordings": video + audio files carrying
// transcripts (text + VTT), audio-event detections, waveforms, moments (one
// exported + publicly shared), and highlight filters.
func (s *seeder) seedPodcast(lib *models.Library, admin, bob *models.User) {
	if s.err != nil {
		return
	}
	day := 24 * time.Hour

	tFeatured := s.createTag("tag/podcast/featured", lib.ID, "featured", "#ec4899", s.ago(40*day))
	tInterview := s.createTag("tag/podcast/interview", lib.ID, "interview", "#14b8a6", s.ago(40*day))
	tHighlight := s.createTag("tag/podcast/highlight", lib.ID, "highlight", "#f97316", s.ago(38*day))

	ep1 := s.addFile(fileSpec{
		idName: "file/podcast/ep1", lib: lib.ID, owner: admin.ID,
		name: "episode-01-welcome.mp4", assetRel: "videos/podcast-ep1.mp4", mime: "video/mp4",
		width: 1280, height: 720, duration: 6, thumbAsset: "thumbs/podcast-ep1.webp",
		createdAt: s.ago(36 * day),
	})
	ep2 := s.addFile(fileSpec{
		idName: "file/podcast/ep2", lib: lib.ID, owner: admin.ID,
		name: "episode-02-deep-dive.mp4", assetRel: "videos/podcast-ep2.mp4", mime: "video/mp4",
		width: 1280, height: 720, duration: 6, thumbAsset: "thumbs/podcast-ep2.webp",
		createdAt: s.ago(22 * day),
	})
	interview := s.addFile(fileSpec{
		idName: "file/podcast/interview", lib: lib.ID, owner: bob.ID,
		name: "guest-interview.mp3", assetRel: "audio/interview-clip.mp3", mime: "audio/mpeg",
		duration: 8, createdAt: s.ago(12 * day),
	})

	s.tagFile(ep1.ID, tFeatured.ID)
	s.tagFile(ep1.ID, tInterview.ID)
	s.tagFile(ep2.ID, tFeatured.ID)
	s.tagFile(interview.ID, tInterview.ID)

	// Transcripts (whisper output shape: plain text + WebVTT cues).
	s.setTranscript(ep1,
		"Welcome to the Alcoves podcast. Today we explore self-hosted media libraries and why owning your data matters.",
		webVTT([]vttCue{
			{"00:00:00.000", "00:00:02.500", "Welcome to the Alcoves podcast."},
			{"00:00:02.500", "00:00:05.000", "Today we explore self-hosted media libraries"},
			{"00:00:05.000", "00:00:06.000", "and why owning your data matters."},
		}), "large-v3")
	s.setTranscript(ep2,
		"In this deep dive we cover face recognition, object detection, and on-device transcription running entirely on CPU.",
		webVTT([]vttCue{
			{"00:00:00.000", "00:00:02.000", "In this deep dive we cover face recognition,"},
			{"00:00:02.000", "00:00:04.000", "object detection, and on-device transcription"},
			{"00:00:04.000", "00:00:06.000", "running entirely on CPU."},
		}), "large-v3")
	s.setTranscript(interview,
		"Thanks for having me. I think privacy-first software is the future for families and small teams.",
		webVTT([]vttCue{
			{"00:00:00.000", "00:00:03.000", "Thanks for having me."},
			{"00:00:03.000", "00:00:06.000", "I think privacy-first software is the future"},
			{"00:00:06.000", "00:00:08.000", "for families and small teams."},
		}), "large-v3")

	// Audio-event detections.
	s.addAudioDetection("aud/podcast/ep1-speech", ep1, lib.ID, "Speech", 0, 0.93, 0, 6)
	s.addAudioDetection("aud/podcast/ep1-music", ep1, lib.ID, "Music", 137, 0.41, 0, 6)
	s.addAudioDetection("aud/podcast/ep1-laugh", ep1, lib.ID, "Laughter", 16, 0.72, 2.0, 3.0)
	s.addAudioDetection("aud/podcast/ep1-applause", ep1, lib.ID, "Applause", 63, 0.6, 5.0, 6.0)
	s.addAudioDetection("aud/podcast/ep2-speech", ep2, lib.ID, "Speech", 0, 0.95, 0, 6)
	s.addAudioDetection("aud/podcast/ep2-music", ep2, lib.ID, "Music", 137, 0.38, 0, 6)
	s.addAudioDetection("aud/podcast/int-speech", interview, lib.ID, "Speech", 0, 0.96, 0, 8)

	// Waveforms (cache JSON + file flags).
	s.addWaveform(ep1, lib.ID, 6)
	s.addWaveform(ep2, lib.ID, 6)
	s.addWaveform(interview, lib.ID, 8)

	// Moments. One is exported + publicly shared.
	mCold := s.addMoment("moment/podcast/cold-open", ep1, lib.ID, admin.ID, "Cold Open",
		"The intro hook before the title card.", 0, 2.5, s.ago(34*day))
	mKey := s.addMoment("moment/podcast/key-takeaway", ep1, lib.ID, admin.ID, "Key Takeaway",
		"Why owning your data matters.", 3.0, 5.5, s.ago(33*day))
	mReveal := s.addMoment("moment/podcast/big-reveal", ep2, lib.ID, bob.ID, "Big Reveal",
		"CPU-only on-device inference.", 1.0, 4.0, s.ago(20*day))
	s.tagMoment(mCold.ID, tHighlight.ID)
	s.tagMoment(mKey.ID, tFeatured.ID)
	s.tagMoment(mReveal.ID, tHighlight.ID)

	// Export + public share for the "Key Takeaway" moment.
	s.exportAndShare(mKey, lib.ID, admin.ID, "videos/podcast-ep1.mp4", "devseedshare01", "share/podcast/key")

	// Highlight filters (expression grammar: `label:minScore`, comma = OR,
	// `&` = AND, `word:<token>` matches transcript words).
	s.addHighlightFilter("hf/podcast/laughter", lib.ID, up(admin.ID), "Laughter",
		"laughter:25, giggle, chuckle", "#22c55e", 5, s.ago(35*day))
	s.addHighlightFilter("hf/podcast/applause", lib.ID, up(admin.ID), "Applause & Cheers",
		"applause:25, cheering, clapping", "#eab308", 5, s.ago(35*day))
	s.addHighlightFilter("hf/podcast/mentions", lib.ID, up(bob.ID), "Mentions Alcoves",
		"word:alcoves, word:welcome", "#3b82f6", 3, s.ago(30*day))

	// Activity feed
	s.addActivity("act/podcast/member-bob", lib.ID, up(admin.ID), activity.ActionMemberJoined, activity.SubjectMember, up(bob.ID),
		map[string]any{"userId": bob.ID.String(), "displayName": bob.DisplayName}, s.ago(38*day))
	s.addFileActivity("act/podcast/file-ep1", lib.ID, admin.ID, ep1, s.ago(36*day))
	s.addFileActivity("act/podcast/file-ep2", lib.ID, admin.ID, ep2, s.ago(22*day))
	s.addFileActivity("act/podcast/file-interview", lib.ID, bob.ID, interview, s.ago(12*day))
	s.addActivity("act/podcast/transcribe-ep1", lib.ID, nil, activity.ActionSystemTranscribeReady, activity.SubjectFile, up(ep1.ID),
		map[string]any{"fileId": ep1.ID.String(), "name": ep1.Name}, s.ago(35*day))
	s.addActivity("act/podcast/waveform-int", lib.ID, nil, activity.ActionSystemWaveformReady, activity.SubjectFile, up(interview.ID),
		map[string]any{"fileId": interview.ID.String(), "name": interview.Name}, s.ago(11*day))
	s.addActivity("act/podcast/moment-key", lib.ID, up(admin.ID), activity.ActionMomentCreated, activity.SubjectMoment, up(mKey.ID),
		map[string]any{"momentId": mKey.ID.String(), "name": mKey.Name, "fileId": ep1.ID.String()}, s.ago(33*day))
	s.addActivity("act/podcast/moment-shared", lib.ID, up(admin.ID), activity.ActionMomentShared, activity.SubjectShare, up(mKey.ID),
		map[string]any{"momentId": mKey.ID.String(), "name": mKey.Name, "token": "devseedshare01"}, s.ago(33*day))
}

type vttCue struct{ start, end, text string }

func webVTT(cues []vttCue) string {
	var b strings.Builder
	b.WriteString("WEBVTT\n\n")
	for _, c := range cues {
		b.WriteString(c.start + " --> " + c.end + "\n" + c.text + "\n\n")
	}
	return b.String()
}
