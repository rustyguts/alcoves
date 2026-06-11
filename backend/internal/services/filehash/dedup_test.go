package filehash

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

func setupDedupDB(t *testing.T) *gorm.DB {
	t.Helper()

	db := testsupport.OpenSchema(t, "svc_filehash")

	if err := db.AutoMigrate(
		&models.User{},
		&models.Library{},
		&models.Folder{},
		&models.File{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}

	db.Exec("TRUNCATE TABLE users RESTART IDENTITY CASCADE")
	return db
}

func mkLibrary(t *testing.T, db *gorm.DB) (uuid.UUID, uuid.UUID) {
	t.Helper()
	user := models.User{BaseModel: models.BaseModel{ID: uuid.New()}, Email: "u-" + uuid.New().String() + "@example.com", DisplayName: "u"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	lib := models.Library{BaseModel: models.BaseModel{ID: uuid.New()}, Name: "lib", OwnerID: user.ID}
	if err := db.Create(&lib).Error; err != nil {
		t.Fatalf("create library: %v", err)
	}
	return user.ID, lib.ID
}

func mkFile(t *testing.T, db *gorm.DB, libraryID, ownerID uuid.UUID, hash *string, sourceFileID *uuid.UUID, trashed bool) uuid.UUID {
	t.Helper()
	f := models.File{
		BaseModel:    models.BaseModel{ID: uuid.New()},
		LibraryID:    libraryID,
		Name:         "f-" + uuid.New().String(),
		MimeType:     "application/octet-stream",
		Size:         123,
		OwnerID:      &ownerID,
		Hash:         hash,
		SourceFileID: sourceFileID,
	}
	if trashed {
		now := time.Now()
		f.TrashedAt = &now
	}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	return f.ID
}

func TestFindDuplicates(t *testing.T) {
	db := setupDedupDB(t)
	ownerA, libA := mkLibrary(t, db)
	_, libB := mkLibrary(t, db)

	hash := "deadbeef"

	a1 := mkFile(t, db, libA, ownerA, &hash, nil, false)
	a2 := mkFile(t, db, libA, ownerA, &hash, nil, false)
	a3 := mkFile(t, db, libA, ownerA, &hash, nil, false)
	// Same library, different hash — not a dup
	otherHash := "feedface"
	mkFile(t, db, libA, ownerA, &otherHash, nil, false)
	// Same hash, different library — not a dup of A
	mkFile(t, db, libB, ownerA, &hash, nil, false)
	// Same hash, same library, but trashed — excluded
	mkFile(t, db, libA, ownerA, &hash, nil, true)
	// Same hash, same library, but a derived/proxy file — excluded
	src := a1
	mkFile(t, db, libA, ownerA, &hash, &src, false)

	dupes, err := FindDuplicates(db, libA, a1, hash)
	if err != nil {
		t.Fatalf("FindDuplicates: %v", err)
	}
	if len(dupes) != 2 {
		t.Fatalf("expected 2 dupes for a1, got %d (%v)", len(dupes), dupes)
	}

	got := map[uuid.UUID]bool{}
	for _, id := range dupes {
		got[id] = true
	}
	if !got[a2] || !got[a3] {
		t.Fatalf("expected a2 + a3 in dupes, got %v", dupes)
	}
	if got[a1] {
		t.Fatalf("self should be excluded")
	}
}

func TestFindDuplicates_EmptyHash(t *testing.T) {
	db := setupDedupDB(t)
	_, libA := mkLibrary(t, db)
	dupes, err := FindDuplicates(db, libA, uuid.New(), "")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(dupes) != 0 {
		t.Fatalf("expected 0, got %d", len(dupes))
	}
}

func TestHasDuplicatesByID(t *testing.T) {
	db := setupDedupDB(t)
	owner, lib := mkLibrary(t, db)

	hash := "deadbeef"
	other := "feedface"

	dup1 := mkFile(t, db, lib, owner, &hash, nil, false)
	dup2 := mkFile(t, db, lib, owner, &hash, nil, false)
	uniq := mkFile(t, db, lib, owner, &other, nil, false)
	noHash := mkFile(t, db, lib, owner, nil, nil, false)

	res, err := HasDuplicatesByID(db, lib, []uuid.UUID{dup1, dup2, uniq, noHash})
	if err != nil {
		t.Fatalf("HasDuplicatesByID: %v", err)
	}
	if !res[dup1] || !res[dup2] {
		t.Fatalf("dup1+dup2 should be flagged, got %v", res)
	}
	if res[uniq] || res[noHash] {
		t.Fatalf("uniq/noHash should not be flagged, got %v", res)
	}
}
