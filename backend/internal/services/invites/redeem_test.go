package invites

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_invites")
	if err := db.AutoMigrate(
		&models.User{},
		&models.Library{},
		&models.LibraryMember{},
		&models.LibraryInvite{},
		&models.LibraryInviteUse{},
	); err != nil {
		t.Fatalf("auto-migrate: %v", err)
	}
	db.Exec("TRUNCATE TABLE users, libraries, library_members, library_invites, library_invite_uses RESTART IDENTITY CASCADE")
	return db
}

func mkUser(t *testing.T, db *gorm.DB, email string) models.User {
	t.Helper()
	u := models.User{Email: email, DisplayName: email, Role: "member"}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

func mkLibrary(t *testing.T, db *gorm.DB, ownerID uuid.UUID) models.Library {
	t.Helper()
	lib := models.Library{Name: "L", OwnerID: ownerID}
	if err := db.Create(&lib).Error; err != nil {
		t.Fatalf("create library: %v", err)
	}
	return lib
}

func mkInvite(t *testing.T, db *gorm.DB, lib models.Library, owner models.User, mut func(*models.LibraryInvite)) models.LibraryInvite {
	t.Helper()
	inv := models.LibraryInvite{
		LibraryID:       lib.ID,
		InvitedByUserID: owner.ID,
		Token:           uuid.NewString(),
	}
	if mut != nil {
		mut(&inv)
	}
	if err := db.Create(&inv).Error; err != nil {
		t.Fatalf("create invite: %v", err)
	}
	return inv
}

func TestLookupRedeemable_Errors(t *testing.T) {
	db := testDB(t)
	owner := mkUser(t, db, "owner@example.com")
	lib := mkLibrary(t, db, owner.ID)

	if _, err := LookupRedeemable(db, "no-such-token"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing: want ErrNotFound, got %v", err)
	}

	revoked := mkInvite(t, db, lib, owner, func(i *models.LibraryInvite) {
		now := time.Now()
		i.RevokedAt = &now
	})
	if _, err := LookupRedeemable(db, revoked.Token); !errors.Is(err, ErrRevoked) {
		t.Fatalf("revoked: want ErrRevoked, got %v", err)
	}

	expired := mkInvite(t, db, lib, owner, func(i *models.LibraryInvite) {
		past := time.Now().Add(-time.Hour)
		i.ExpiresAt = &past
	})
	if _, err := LookupRedeemable(db, expired.Token); !errors.Is(err, ErrExpired) {
		t.Fatalf("expired: want ErrExpired, got %v", err)
	}

	maxOne := 1
	exhausted := mkInvite(t, db, lib, owner, func(i *models.LibraryInvite) {
		i.MaxUses = &maxOne
		i.UseCount = 1
	})
	if _, err := LookupRedeemable(db, exhausted.Token); !errors.Is(err, ErrExhausted) {
		t.Fatalf("exhausted: want ErrExhausted, got %v", err)
	}

	live := mkInvite(t, db, lib, owner, nil)
	if _, err := LookupRedeemable(db, live.Token); err != nil {
		t.Fatalf("live: want nil, got %v", err)
	}
}

func TestRedeem_CreatesMembershipAndUsage(t *testing.T) {
	db := testDB(t)
	owner := mkUser(t, db, "owner-cm@example.com")
	joiner := mkUser(t, db, "joiner@example.com")
	lib := mkLibrary(t, db, owner.ID)
	inv := mkInvite(t, db, lib, owner, nil)

	if _, err := Redeem(db, &inv, joiner.ID); err != nil {
		t.Fatalf("Redeem: %v", err)
	}

	var memberCount int64
	db.Model(&models.LibraryMember{}).Where("library_id = ? AND user_id = ?", lib.ID, joiner.ID).Count(&memberCount)
	if memberCount != 1 {
		t.Fatalf("expected 1 library_members row, got %d", memberCount)
	}

	var useCount int64
	db.Model(&models.LibraryInviteUse{}).Where("invite_id = ? AND user_id = ?", inv.ID, joiner.ID).Count(&useCount)
	if useCount != 1 {
		t.Fatalf("expected 1 library_invite_uses row, got %d", useCount)
	}

	var reloaded models.LibraryInvite
	db.Where("id = ?", inv.ID).First(&reloaded)
	if reloaded.UseCount != 1 {
		t.Fatalf("expected use_count=1, got %d", reloaded.UseCount)
	}
}

func TestRedeem_Idempotent(t *testing.T) {
	db := testDB(t)
	owner := mkUser(t, db, "owner-idem@example.com")
	joiner := mkUser(t, db, "joiner-idem@example.com")
	lib := mkLibrary(t, db, owner.ID)
	inv := mkInvite(t, db, lib, owner, nil)

	for i := 0; i < 2; i++ {
		if _, err := Redeem(db, &inv, joiner.ID); err != nil {
			t.Fatalf("Redeem #%d: %v", i, err)
		}
	}

	var useCount int64
	db.Model(&models.LibraryInviteUse{}).Where("invite_id = ? AND user_id = ?", inv.ID, joiner.ID).Count(&useCount)
	if useCount != 1 {
		t.Fatalf("expected exactly 1 usage row, got %d", useCount)
	}

	var reloaded models.LibraryInvite
	db.Where("id = ?", inv.ID).First(&reloaded)
	if reloaded.UseCount != 1 {
		t.Fatalf("expected use_count=1 after duplicate redeem, got %d", reloaded.UseCount)
	}

	var memberCount int64
	db.Model(&models.LibraryMember{}).Where("library_id = ? AND user_id = ?", lib.ID, joiner.ID).Count(&memberCount)
	if memberCount != 1 {
		t.Fatalf("expected exactly 1 membership, got %d", memberCount)
	}
}

func TestRedeem_DifferentUsersBumpsCount(t *testing.T) {
	db := testDB(t)
	owner := mkUser(t, db, "owner-d@example.com")
	a := mkUser(t, db, "a@example.com")
	b := mkUser(t, db, "b@example.com")
	lib := mkLibrary(t, db, owner.ID)
	inv := mkInvite(t, db, lib, owner, nil)

	if _, err := Redeem(db, &inv, a.ID); err != nil {
		t.Fatalf("redeem a: %v", err)
	}
	if _, err := Redeem(db, &inv, b.ID); err != nil {
		t.Fatalf("redeem b: %v", err)
	}

	var reloaded models.LibraryInvite
	db.Where("id = ?", inv.ID).First(&reloaded)
	if reloaded.UseCount != 2 {
		t.Fatalf("expected use_count=2, got %d", reloaded.UseCount)
	}
}

func TestRedeem_OwnerReturnsErrAlreadyMember(t *testing.T) {
	db := testDB(t)
	owner := mkUser(t, db, "owner-self@example.com")
	lib := mkLibrary(t, db, owner.ID)
	inv := mkInvite(t, db, lib, owner, nil)

	_, err := Redeem(db, &inv, owner.ID)
	if !errors.Is(err, ErrAlreadyMember) {
		t.Fatalf("want ErrAlreadyMember, got %v", err)
	}
}

func TestRedeem_RaceUnderMaxUses(t *testing.T) {
	db := testDB(t)
	owner := mkUser(t, db, "owner-mx@example.com")
	a := mkUser(t, db, "a-mx@example.com")
	b := mkUser(t, db, "b-mx@example.com")
	lib := mkLibrary(t, db, owner.ID)
	one := 1
	inv := mkInvite(t, db, lib, owner, func(i *models.LibraryInvite) {
		i.MaxUses = &one
	})

	if _, err := Redeem(db, &inv, a.ID); err != nil {
		t.Fatalf("redeem a: %v", err)
	}
	// Second user must be rejected because slot is consumed.
	_, err := Redeem(db, &inv, b.ID)
	if !errors.Is(err, ErrExhausted) {
		t.Fatalf("expected ErrExhausted, got %v", err)
	}

	var bMember int64
	db.Model(&models.LibraryMember{}).Where("library_id = ? AND user_id = ?", lib.ID, b.ID).Count(&bMember)
	if bMember != 0 {
		t.Fatalf("user b should not have membership, got %d", bMember)
	}
}
