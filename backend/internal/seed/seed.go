// Package seed loads representative dev/test data into an empty database so a
// fresh `docker compose up` (or a test) shows real content in every view —
// libraries, folders, files (images/video/audio), tags, people & faces, object
// detections, transcripts, audio events, waveforms, moments, a public share,
// highlight filters, the activity feed, and a personal access token.
//
// It is intentionally NOT part of normal startup. MaybeRun only acts when
// seeding is explicitly enabled (ALCOVES_SEED=true, set in docker-compose for
// local dev) AND the database is empty. Real first-time setups never set that
// flag, so a real owner's onboarding is untouched.
//
// Keep this seed relevant: when you add or change a user-facing feature, extend
// the seeder so the feature has representative data here (see CLAUDE.md).
package seed

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const (
	// AdminEmail is the seeded owner/admin account used for local dev + tests.
	AdminEmail = "test@alcoves.io"
	// AliceEmail and BobEmail are seeded member accounts for collaboration testing.
	AliceEmail = "alice@alcoves.io"
	BobEmail   = "bob@alcoves.io"
	// DefaultPassword is the plaintext password shared by every seeded account.
	DefaultPassword = "password123"
	// DevAccessToken is a fixed personal access token plaintext for the admin
	// account, handy for poking the MCP server / API from the CLI in local dev.
	DevAccessToken = "alc_pat_localdev0000000000000000000000000000"
)

// seedNS namespaces deterministic (v5) UUIDs so re-seeding a wiped DB reuses the
// same IDs and storage keys — stable URLs for tests and no orphaned blobs.
var seedNS = uuid.MustParse("5eed0000-0000-4000-8000-00000000a1c0")

// seedAdvisoryLockKey namespaces the Postgres advisory lock that serializes
// concurrent MaybeRun calls so API replicas starting together cannot both
// observe an empty database and double-seed.
const seedAdvisoryLockKey = 0x5EED5EED

func id(parts ...string) uuid.UUID {
	return uuid.NewSHA1(seedNS, []byte(strings.Join(parts, "/")))
}

// Result summarizes what a seeding run created (for logging + test assertions).
type Result struct {
	Users      int
	Libraries  int
	Folders    int
	Files      int
	Tags       int
	People     int
	Faces      int
	Objects    int
	Moments    int
	Activities int
}

// MaybeRun seeds dev/test data when enabled and the database is empty.
//
// Gating rationale:
//   - enabled (ALCOVES_SEED): opt-in; real deployments never set it.
//   - mode != "worker": only API/all processes seed, so an api+worker split
//     doesn't double-seed (the empty-DB check also guards this).
//   - zero users: a populated DB (real users, or an already-seeded dev DB) is
//     left untouched, so this is safe to call on every boot.
func MaybeRun(db *gorm.DB, st *storage.Service, enabled bool, mode, environment string) error {
	if !enabled || mode == "worker" {
		return nil
	}
	// Safety net: never seed a production database, even if the flag is set by
	// mistake — seeding creates known-credential accounts and a fixed PAT.
	if environment == "production" {
		log.Println("seed: ALCOVES_SEED set but ALCOVES_ENV=production — refusing to seed")
		return nil
	}

	// Serialize concurrent starters (multiple API replicas) with a session
	// Postgres advisory lock held on one dedicated connection, so two processes
	// cannot both observe an empty DB and double-seed. It releases on conn close.
	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("seed: db handle: %w", err)
	}
	ctx := context.Background()
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("seed: acquire connection: %w", err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", seedAdvisoryLockKey); err != nil {
		return fmt.Errorf("seed: advisory lock: %w", err)
	}
	defer func() { _, _ = conn.ExecContext(ctx, "SELECT pg_advisory_unlock($1)", seedAdvisoryLockKey) }()

	var users int64
	if err := db.Model(&models.User{}).Count(&users).Error; err != nil {
		return fmt.Errorf("seed: count users: %w", err)
	}
	if users > 0 {
		log.Printf("seed: database already has %d user(s); skipping dev seed", users)
		return nil
	}

	log.Println("seed: empty database + ALCOVES_SEED — loading dev/test seed data")
	res, err := Run(db, st)
	if err != nil {
		return fmt.Errorf("seed: %w", err)
	}
	log.Printf("seed: done — %d users, %d libraries, %d folders, %d files, %d tags, %d people, %d faces, %d objects, %d moments, %d activities",
		res.Users, res.Libraries, res.Folders, res.Files, res.Tags, res.People, res.Faces, res.Objects, res.Moments, res.Activities)
	log.Printf("seed: log in with %s / %s (owner/admin)", AdminEmail, DefaultPassword)
	return nil
}

// Run loads the full seed data set into db (+ storage). It assumes an empty-ish
// database (MaybeRun enforces that); it is also called directly by tests with an
// isolated schema and a temp storage root.
func Run(db *gorm.DB, st *storage.Service) (Result, error) {
	s := &seeder{db: db, st: st, now: time.Now().UTC()}
	if err := s.run(); err != nil {
		return s.res, err
	}
	return s.res, nil
}

type seeder struct {
	db  *gorm.DB
	st  *storage.Service
	now time.Time
	res Result
	// err holds the first error encountered. Helper methods short-circuit when
	// it is set, so the orchestration in run() reads top-to-bottom without an
	// error check after every call.
	err error
}

// fail records the first error and returns it.
func (s *seeder) fail(err error) error {
	if s.err == nil {
		s.err = err
	}
	return s.err
}

// ago returns a timestamp `d` before the run's reference time.
func (s *seeder) ago(d time.Duration) time.Time { return s.now.Add(-d) }

func (s *seeder) run() error {
	if err := s.st.EnsureReady(); err != nil {
		return fmt.Errorf("storage not ready: %w", err)
	}

	// Open registration by default in dev so you can also register extra
	// accounts on top of the seed.
	if err := s.ensureRegistrationOpen(); err != nil {
		return err
	}

	// --- Users -------------------------------------------------------------
	admin := s.createUser("user/admin", AdminEmail, "Test Admin", "owner", "faces/alice.webp", s.ago(120*24*time.Hour))
	alice := s.createUser("user/alice", AliceEmail, "Alice Rivera", "member", "faces/bob.webp", s.ago(90*24*time.Hour))
	bob := s.createUser("user/bob", BobEmail, "Bob Chen", "member", "faces/unknown.webp", s.ago(60*24*time.Hour))
	if s.err != nil {
		return s.err
	}

	// --- Libraries ---------------------------------------------------------
	family := s.createLibrary("lib/family", "Family Photos", "📸", true, true, true, true, admin.ID, s.ago(120*24*time.Hour))
	travel := s.createLibrary("lib/travel", "Travel 2025", "✈️", false, false, true, true, admin.ID, s.ago(80*24*time.Hour))
	podcast := s.createLibrary("lib/podcast", "Podcast Recordings", "🎙️", false, false, false, true, admin.ID, s.ago(40*24*time.Hour))
	// Personal default libraries so logging in as a member isn't an empty shell.
	s.createLibrary("lib/alice", "Alice's Library", "🌅", true, false, false, false, alice.ID, s.ago(85*24*time.Hour))
	s.createLibrary("lib/bob", "Bob's Library", "🎧", true, false, false, false, bob.ID, s.ago(55*24*time.Hour))

	// Memberships (owner access is implicit via Library.OwnerID).
	s.addMember("mem/family-alice", family.ID, alice.ID, "admin", s.ago(118*24*time.Hour))
	s.addMember("mem/family-bob", family.ID, bob.ID, "viewer", s.ago(100*24*time.Hour))
	s.addMember("mem/travel-alice", travel.ID, alice.ID, "viewer", s.ago(78*24*time.Hour))
	s.addMember("mem/podcast-bob", podcast.ID, bob.ID, "admin", s.ago(38*24*time.Hour))

	if s.err != nil {
		return s.err
	}

	// --- Content per library ----------------------------------------------
	s.seedFamily(family, admin, alice, bob)
	s.seedTravel(travel, admin, alice)
	s.seedPodcast(podcast, admin, bob)

	// A fixed personal access token for the admin account, for poking the MCP
	// server / API from the CLI in local dev.
	s.addPAT("pat/admin", admin.ID, "Local Dev Token", DevAccessToken, s.ago(10*24*time.Hour))

	return s.err
}

// ensureRegistrationOpen sets registration mode to "open" (best effort) so dev
// can register extra accounts. The settings service seeds the row at boot; this
// just normalizes the mode if a stale row exists.
func (s *seeder) ensureRegistrationOpen() error {
	raw, _ := json.Marshal(map[string]any{
		"registration_mode":  "open",
		"whisper_model":      "large-v3",
		"whisper_language":   "auto",
		"audio_detect_model": "efficientat_mn10",
	})
	row := models.AppSettings{ID: 1, Settings: raw, UpdatedAt: s.now}
	// Upsert the single settings row.
	if err := s.db.Where("id = ?", 1).Assign(map[string]any{"settings": raw}).FirstOrCreate(&row).Error; err != nil {
		return fmt.Errorf("seed app_settings: %w", err)
	}
	return nil
}
