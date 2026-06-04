package facedetection

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// faceTestDB connects to the shared test postgres and (re)creates the
// people + face_detections tables with a real pgvector embedding column.
// It skips the test when the database or the vector extension is unavailable.
func faceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_facedet")

	if err := db.Exec("CREATE EXTENSION IF NOT EXISTS vector").Error; err != nil {
		t.Skipf("Skipping: pgvector extension unavailable: %v", err)
	}

	// Drop and recreate to get a clean, isolated schema for this package.
	stmts := []string{
		`DROP TABLE IF EXISTS face_detections`,
		`DROP TABLE IF EXISTS people`,
		`CREATE TABLE people (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			library_id UUID NOT NULL,
			name TEXT,
			cover_face_detection_id UUID,
			face_count INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE face_detections (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			file_id UUID NOT NULL,
			library_id UUID NOT NULL,
			person_id UUID,
			box_x INTEGER NOT NULL DEFAULT 0,
			box_y INTEGER NOT NULL DEFAULT 0,
			box_width INTEGER NOT NULL DEFAULT 0,
			box_height INTEGER NOT NULL DEFAULT 0,
			image_width INTEGER NOT NULL DEFAULT 0,
			image_height INTEGER NOT NULL DEFAULT 0,
			confidence INTEGER NOT NULL DEFAULT 0,
			quality_score INTEGER,
			embedding vector(512),
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
	}
	for _, s := range stmts {
		if err := db.Exec(s).Error; err != nil {
			t.Skipf("Skipping: cannot prepare face schema: %v", err)
		}
	}
	t.Cleanup(func() {
		db.Exec("DROP TABLE IF EXISTS face_detections")
		db.Exec("DROP TABLE IF EXISTS people")
	})
	return db
}

// unitEmbedding builds a 512-dim embedding that is `val` at index `hot` and
// a small base value elsewhere, then L2-normalizes it. Two embeddings with the
// same `hot` index are near each other (cosine distance ~0); different hot
// indexes are far apart.
func unitEmbedding(hot int, val float32) []float32 {
	v := make([]float32, embDim)
	for i := range v {
		v[i] = 0.001
	}
	v[hot] = val
	l2Normalize(v)
	return v
}

// insertFace inserts a face_detection row with the given embedding and returns its id.
func insertFace(t *testing.T, db *gorm.DB, libraryID string, fileID uuid.UUID, personID *uuid.UUID, quality int, emb []float32) uuid.UUID {
	t.Helper()
	id := uuid.New()
	embStr := embeddingToString(emb)
	var pid interface{}
	if personID != nil {
		pid = *personID
	}
	err := db.Exec(`
		INSERT INTO face_detections (id, file_id, library_id, person_id, quality_score, embedding, created_at)
		VALUES (?, ?, ?, ?, ?, ?::vector, NOW())
	`, id, fileID, libraryID, pid, quality, embStr).Error
	if err != nil {
		t.Fatalf("insertFace: %v", err)
	}
	return id
}

// insertPerson inserts a people row with a given face count and returns its id.
func insertPerson(t *testing.T, db *gorm.DB, libraryID string, faceCount int) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if err := db.Exec(`INSERT INTO people (id, library_id, face_count) VALUES (?, ?, ?)`, id, libraryID, faceCount).Error; err != nil {
		t.Fatalf("insertPerson: %v", err)
	}
	return id
}

func countFacesForPerson(t *testing.T, db *gorm.DB, personID uuid.UUID) int {
	t.Helper()
	var n int64
	db.Raw("SELECT COUNT(*) FROM face_detections WHERE person_id = ?", personID).Scan(&n)
	return int(n)
}

func personExists(t *testing.T, db *gorm.DB, personID uuid.UUID) bool {
	t.Helper()
	var n int64
	db.Raw("SELECT COUNT(*) FROM people WHERE id = ?", personID).Scan(&n)
	return n > 0
}

func newLibraryID() string {
	return uuid.New().String()
}

// sanity check that the helpers produce a valid pgvector literal of the right dim.
func TestUnitEmbedding_Dim(t *testing.T) {
	e := unitEmbedding(0, 1)
	if len(e) != embDim {
		t.Fatalf("embedding dim = %d, want %d", len(e), embDim)
	}
	s := embeddingToString(e)
	if !strings.HasPrefix(s, "[") || !strings.HasSuffix(s, "]") {
		t.Fatalf("bad pgvector literal: %q", s)
	}
	if c := strings.Count(s, ",") + 1; c != embDim {
		t.Fatalf("pgvector literal has %d components, want %d", c, embDim)
	}
}
