package filehash

import (
	"testing"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func TestFindDuplicates_QueryError(t *testing.T) {
	db := setupDedupDB(t)
	_, lib := mkLibrary(t, db)

	if err := db.Migrator().DropTable("files"); err != nil {
		t.Skipf("Skipping: could not drop files table: %v", err)
	}
	t.Cleanup(func() { _ = db.AutoMigrate(&models.File{}) })

	_, err := FindDuplicates(db, lib, uuid.New(), "somehash")
	if err == nil {
		t.Fatal("expected error when files table is missing")
	}
}

func TestHasDuplicatesByID_EmptyInput(t *testing.T) {
	db := setupDedupDB(t)
	res, err := HasDuplicatesByID(db, uuid.New(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res) != 0 {
		t.Fatalf("expected empty map, got %v", res)
	}
}

func TestHasDuplicatesByID_QueryError(t *testing.T) {
	db := setupDedupDB(t)
	_, lib := mkLibrary(t, db)

	if err := db.Migrator().DropTable("files"); err != nil {
		t.Skipf("Skipping: could not drop files table: %v", err)
	}
	t.Cleanup(func() { _ = db.AutoMigrate(&models.File{}) })

	_, err := HasDuplicatesByID(db, lib, []uuid.UUID{uuid.New()})
	if err == nil {
		t.Fatal("expected error when files table is missing")
	}
}
