package facedetection

import (
	"testing"

	"github.com/google/uuid"
)

// TestAssignFaceUsingCorePoint_MatchExistingPerson assigns a new face to a nearby
// existing person via vote/distance logic.
func TestAssignFaceUsingCorePoint_MatchExistingPerson(t *testing.T) {
	db := faceTestDB(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	lib := newLibraryID()

	person := insertPerson(t, db, lib, 2)
	// Two assigned faces close to the "hot index 0" direction.
	insertFace(t, db, lib, uuid.New(), &person, 90, unitEmbedding(0, 5))
	insertFace(t, db, lib, uuid.New(), &person, 85, unitEmbedding(0, 5.1))

	// New unassigned face, also near hot index 0.
	newID := insertFace(t, db, lib, uuid.New(), nil, 80, unitEmbedding(0, 4.9))
	emb := unitEmbedding(0, 4.9)

	res, err := AssignFaceUsingCorePoint(db, cfg, lib, newID, emb)
	if err != nil {
		t.Fatalf("AssignFaceUsingCorePoint: %v", err)
	}
	if res == nil {
		t.Fatal("expected assignment result, got nil")
	}
	if res.IsNew {
		t.Errorf("expected match to existing person, got IsNew=true")
	}
	if res.PersonID != person {
		t.Errorf("assigned to %s, want existing person %s", res.PersonID, person)
	}
	// The face's person_id should now be set.
	var pid string
	db.Raw("SELECT person_id::text FROM face_detections WHERE id = ?", newID).Scan(&pid)
	if pid != person.String() {
		t.Errorf("face person_id = %q, want %s", pid, person)
	}
}

// TestAssignFaceUsingCorePoint_CreateNewPerson forms a new cluster when there are
// enough nearby unassigned faces and no existing person matches.
func TestAssignFaceUsingCorePoint_CreateNewPerson(t *testing.T) {
	db := faceTestDB(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	lib := newLibraryID()

	// Three unassigned faces near hot index 5, no assigned people anywhere.
	insertFace(t, db, lib, uuid.New(), nil, 70, unitEmbedding(5, 5))
	insertFace(t, db, lib, uuid.New(), nil, 72, unitEmbedding(5, 5.05))
	newID := insertFace(t, db, lib, uuid.New(), nil, 75, unitEmbedding(5, 4.95))
	emb := unitEmbedding(5, 4.95)

	res, err := AssignFaceUsingCorePoint(db, cfg, lib, newID, emb)
	if err != nil {
		t.Fatalf("AssignFaceUsingCorePoint: %v", err)
	}
	if res == nil {
		t.Fatal("expected a new person to be created, got nil")
	}
	if !res.IsNew {
		t.Errorf("expected IsNew=true for new cluster")
	}
	// The new person should have a cover photo and at least MinFaces members.
	if got := countFacesForPerson(t, db, res.PersonID); got < cfg.MinFaces {
		t.Errorf("new person has %d faces, want >= %d", got, cfg.MinFaces)
	}
	var cover string
	db.Raw("SELECT cover_face_detection_id::text FROM people WHERE id = ?", res.PersonID).Scan(&cover)
	if cover != newID.String() {
		t.Errorf("cover_face_detection_id = %q, want %s", cover, newID)
	}
}

// TestAssignFaceUsingCorePoint_NotEnoughEvidence leaves the face unassigned when
// there are too few nearby faces to justify a new cluster.
func TestAssignFaceUsingCorePoint_NotEnoughEvidence(t *testing.T) {
	db := faceTestDB(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	lib := newLibraryID()

	// Only the single new face exists near hot index 9 — nothing else nearby.
	newID := insertFace(t, db, lib, uuid.New(), nil, 60, unitEmbedding(9, 5))
	// Add a far-away unassigned face that should NOT count as nearby.
	insertFace(t, db, lib, uuid.New(), nil, 60, unitEmbedding(100, 5))
	emb := unitEmbedding(9, 5)

	res, err := AssignFaceUsingCorePoint(db, cfg, lib, newID, emb)
	if err != nil {
		t.Fatalf("AssignFaceUsingCorePoint: %v", err)
	}
	if res != nil {
		t.Errorf("expected nil result (left unassigned), got %+v", res)
	}
}

// TestAssignFaceUsingCorePoint_NoNeighbors handles an empty library gracefully.
func TestAssignFaceUsingCorePoint_NoNeighbors(t *testing.T) {
	db := faceTestDB(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	lib := newLibraryID()

	newID := insertFace(t, db, lib, uuid.New(), nil, 50, unitEmbedding(0, 5))
	emb := unitEmbedding(0, 5)

	res, err := AssignFaceUsingCorePoint(db, cfg, lib, newID, emb)
	if err != nil {
		t.Fatalf("AssignFaceUsingCorePoint: %v", err)
	}
	// MinFaces=3 but only one face exists -> unassigned.
	if res != nil {
		t.Errorf("expected nil result for lone face, got %+v", res)
	}
}

// TestReconcileNewPerson_NoSamples returns the source person unchanged when it has no faces.
func TestReconcileNewPerson_NoSamples(t *testing.T) {
	db := faceTestDB(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	lib := newLibraryID()

	source := insertPerson(t, db, lib, 0) // no faces

	final, err := ReconcileNewPerson(db, cfg, lib, source)
	if err != nil {
		t.Fatalf("ReconcileNewPerson: %v", err)
	}
	if final != source {
		t.Errorf("expected source %s returned unchanged, got %s", source, final)
	}
}

// TestReconcileNewPerson_NoMergeTarget keeps the source person when no other
// person is close enough to merge.
func TestReconcileNewPerson_NoMergeTarget(t *testing.T) {
	db := faceTestDB(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	lib := newLibraryID()

	source := insertPerson(t, db, lib, 1)
	insertFace(t, db, lib, uuid.New(), &source, 90, unitEmbedding(0, 5))

	// A far-away other person.
	other := insertPerson(t, db, lib, 1)
	insertFace(t, db, lib, uuid.New(), &other, 90, unitEmbedding(200, 5))

	final, err := ReconcileNewPerson(db, cfg, lib, source)
	if err != nil {
		t.Fatalf("ReconcileNewPerson: %v", err)
	}
	if final != source {
		t.Errorf("expected no merge (source kept), got %s", final)
	}
	if !personExists(t, db, source) || !personExists(t, db, other) {
		t.Errorf("both people should still exist when no merge happens")
	}
}

// TestReconcileNewPerson_AutoMerge merges the source into a close existing person
// when there is enough voting evidence.
func TestReconcileNewPerson_AutoMerge(t *testing.T) {
	db := faceTestDB(t)
	// MinFaces=1 so AutoMergeMinEvidence=1 — one close neighbor is enough.
	cfg := NewFaceConfig(0.5, 0.6, 10, 1, "/models")
	lib := newLibraryID()

	source := insertPerson(t, db, lib, 2)
	insertFace(t, db, lib, uuid.New(), &source, 90, unitEmbedding(0, 5))
	insertFace(t, db, lib, uuid.New(), &source, 88, unitEmbedding(0, 5.02))

	// Target person with faces very close to source's faces (same hot index).
	target := insertPerson(t, db, lib, 2)
	insertFace(t, db, lib, uuid.New(), &target, 95, unitEmbedding(0, 5.01))
	insertFace(t, db, lib, uuid.New(), &target, 93, unitEmbedding(0, 4.99))

	final, err := ReconcileNewPerson(db, cfg, lib, source)
	if err != nil {
		t.Fatalf("ReconcileNewPerson: %v", err)
	}
	if final != target {
		t.Errorf("expected merge into target %s, got %s", target, final)
	}
	// Source person should be deleted, its faces moved to target.
	if personExists(t, db, source) {
		t.Errorf("source person %s should be deleted after merge", source)
	}
	if got := countFacesForPerson(t, db, target); got != 4 {
		t.Errorf("target should have 4 faces after merge, got %d", got)
	}
}
