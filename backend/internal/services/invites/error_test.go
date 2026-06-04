package invites

import (
	"testing"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// freshDB opens a connection without truncating, so callers can mutate the
// schema for error-path tests.
func freshDB(t *testing.T) *gorm.DB {
	t.Helper()
	return testsupport.OpenSchema(t, "svc_invites")
}

func brokenPool(t *testing.T) *gorm.DB {
	t.Helper()
	db := freshDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("db handle: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close pool: %v", err)
	}
	return db
}

// TestLookupRedeemable_GenericDBError drives the non-ErrRecordNotFound error
// path (closed connection pool → query errors).
func TestLookupRedeemable_GenericDBError(t *testing.T) {
	db := brokenPool(t)
	if _, err := LookupRedeemable(db, "any-token"); err == nil {
		t.Fatal("expected a DB error from a closed pool")
	}
}

// TestRedeem_LibraryLookupError drives the first error return inside the
// transaction (the owner-check library SELECT fails). We seed the rows, then
// drop the owner_id column so the `Select("id, owner_id")` inside the
// transaction fails — the transaction begins fine but the query errors.
func TestRedeem_LibraryLookupError(t *testing.T) {
	db := testDB(t)
	owner := mkUser(t, db, "errlib-owner@example.com")
	joiner := mkUser(t, db, "errlib-joiner@example.com")
	lib := mkLibrary(t, db, owner.ID)
	inv := mkInvite(t, db, lib, owner, nil)

	if err := db.Exec("DROP TABLE IF EXISTS libraries CASCADE").Error; err != nil {
		t.Fatalf("drop libraries: %v", err)
	}
	t.Cleanup(func() {
		db.Exec("TRUNCATE TABLE library_invites RESTART IDENTITY CASCADE")
		db.AutoMigrate(&models.Library{})
	})

	if _, err := Redeem(db, &inv, joiner.ID); err == nil {
		t.Fatal("expected library-lookup error with missing libraries table")
	}

	// Clear the orphaned invite row before recreating libraries so the next
	// test's AutoMigrate/TRUNCATE finds a consistent schema.
	if err := db.Exec("TRUNCATE TABLE library_invites RESTART IDENTITY CASCADE").Error; err != nil {
		t.Fatalf("clear invites: %v", err)
	}
	if err := db.AutoMigrate(&models.Library{}); err != nil {
		t.Fatalf("restore libraries: %v", err)
	}
}

// TestRedeem_BrokenPoolFailsToBeginTx drives the outer transaction-begin
// failure path (closed connection pool).
func TestRedeem_BrokenPoolFailsToBeginTx(t *testing.T) {
	good := testDB(t)
	owner := mkUser(t, good, "pool-owner@example.com")
	joiner := mkUser(t, good, "pool-joiner@example.com")
	lib := mkLibrary(t, good, owner.ID)
	inv := mkInvite(t, good, lib, owner, nil)

	bad := brokenPool(t)
	if _, err := Redeem(bad, &inv, joiner.ID); err == nil {
		t.Fatal("expected error from a closed pool")
	}
}

// TestRedeem_UsageInsertError drops library_invite_uses so the usage insert
// inside the transaction fails (covers `return res.Error`).
func TestRedeem_UsageInsertError(t *testing.T) {
	db := testDB(t)
	owner := mkUser(t, db, "usageerr-owner@example.com")
	joiner := mkUser(t, db, "usageerr-joiner@example.com")
	lib := mkLibrary(t, db, owner.ID)
	inv := mkInvite(t, db, lib, owner, nil)

	if err := db.Exec("DROP TABLE IF EXISTS library_invite_uses CASCADE").Error; err != nil {
		t.Fatalf("drop uses: %v", err)
	}
	t.Cleanup(func() { db.AutoMigrate(&models.LibraryInviteUse{}) })

	if _, err := Redeem(db, &inv, joiner.ID); err == nil {
		t.Fatal("expected usage-insert error with missing library_invite_uses table")
	}

	// Restore so subsequent tests (which TRUNCATE it) find the table.
	if err := db.AutoMigrate(&models.LibraryInviteUse{}); err != nil {
		t.Fatalf("restore uses: %v", err)
	}
}

// TestRedeem_MemberCreateError drops library_members so the membership
// insert fails (covers that `return err`). library_invite_uses must remain
// so the usage insert succeeds and we reach the member-create step.
func TestRedeem_MemberCreateError(t *testing.T) {
	db := testDB(t)
	owner := mkUser(t, db, "memcreate-owner@example.com")
	joiner := mkUser(t, db, "memcreate-joiner@example.com")
	lib := mkLibrary(t, db, owner.ID)
	inv := mkInvite(t, db, lib, owner, nil)

	if err := db.Exec("DROP TABLE IF EXISTS library_members CASCADE").Error; err != nil {
		t.Fatalf("drop members: %v", err)
	}
	t.Cleanup(func() { db.AutoMigrate(&models.LibraryMember{}) })

	if _, err := Redeem(db, &inv, joiner.ID); err == nil {
		t.Fatal("expected member-create error with missing library_members table")
	}

	if err := db.AutoMigrate(&models.LibraryMember{}); err != nil {
		t.Fatalf("restore members: %v", err)
	}
}

// TestRedeem_UseCountUpdateError drops the use_count column so the final
// UpdateColumn("use_count", ...) fails after every prior step succeeded.
// MaxUses is left nil so the exhaustion re-check is skipped and we reach
// the bump-use_count branch.
func TestRedeem_UseCountUpdateError(t *testing.T) {
	db := testDB(t)
	owner := mkUser(t, db, "ucupd-owner@example.com")
	joiner := mkUser(t, db, "ucupd-joiner@example.com")
	lib := mkLibrary(t, db, owner.ID)
	inv := mkInvite(t, db, lib, owner, nil)

	if err := db.Exec("ALTER TABLE library_invites DROP COLUMN use_count").Error; err != nil {
		t.Fatalf("drop use_count column: %v", err)
	}
	t.Cleanup(func() { db.AutoMigrate(&models.LibraryInvite{}) })

	if _, err := Redeem(db, &inv, joiner.ID); err == nil {
		t.Fatal("expected use_count update error with missing column")
	}

	if err := db.AutoMigrate(&models.LibraryInvite{}); err != nil {
		t.Fatalf("restore use_count column: %v", err)
	}
}

// TestRedeem_ExhaustionRecheckError sets MaxUses (so the re-check runs) then
// drops the max_uses column so the re-check SELECT fails. The usage insert
// succeeds first (newUsage == true), so we enter the re-check branch.
func TestRedeem_ExhaustionRecheckError(t *testing.T) {
	db := testDB(t)
	owner := mkUser(t, db, "recheck-owner@example.com")
	joiner := mkUser(t, db, "recheck-joiner@example.com")
	lib := mkLibrary(t, db, owner.ID)
	five := 5
	inv := mkInvite(t, db, lib, owner, func(i *models.LibraryInvite) { i.MaxUses = &five })

	if err := db.Exec("ALTER TABLE library_invites DROP COLUMN max_uses").Error; err != nil {
		t.Fatalf("drop max_uses column: %v", err)
	}
	t.Cleanup(func() { db.AutoMigrate(&models.LibraryInvite{}) })

	if _, err := Redeem(db, &inv, joiner.ID); err == nil {
		t.Fatal("expected exhaustion re-check error with missing max_uses column")
	}

	if err := db.AutoMigrate(&models.LibraryInvite{}); err != nil {
		t.Fatalf("restore max_uses column: %v", err)
	}
}
