package invites

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// Sentinel errors returned by Redeem and LookupRedeemable.
var (
	ErrNotFound      = errors.New("invite not found")
	ErrRevoked       = errors.New("invite revoked")
	ErrExpired       = errors.New("invite expired")
	ErrExhausted     = errors.New("invite has no remaining uses")
	ErrAlreadyMember = errors.New("already a member of this library")
)

// LookupRedeemable fetches an invite by token and returns it only if it is
// currently redeemable (not revoked, not expired, has remaining uses).
func LookupRedeemable(db *gorm.DB, token string) (*models.LibraryInvite, error) {
	var invite models.LibraryInvite
	if err := db.Where("token = ?", token).First(&invite).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if invite.RevokedAt != nil {
		return &invite, ErrRevoked
	}
	if invite.ExpiresAt != nil && invite.ExpiresAt.Before(time.Now()) {
		return &invite, ErrExpired
	}
	if invite.MaxUses != nil && invite.UseCount >= *invite.MaxUses {
		return &invite, ErrExhausted
	}
	return &invite, nil
}

// Redeem consumes an invite for the given user inside a transaction:
//   - inserts a LibraryInviteUse row (UNIQUE constraint => idempotent)
//   - inserts a LibraryMember row if not already present
//   - increments use_count when a new usage row was inserted
//
// The library owner is treated as already-a-member.
func Redeem(db *gorm.DB, invite *models.LibraryInvite, userID uuid.UUID) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// Owner check
		var library models.Library
		if err := tx.Select("id, owner_id").Where("id = ?", invite.LibraryID).First(&library).Error; err != nil {
			return err
		}
		if library.OwnerID == userID {
			return ErrAlreadyMember
		}

		// Insert usage row idempotently.
		usage := models.LibraryInviteUse{
			InviteID: invite.ID,
			UserID:   userID,
			UsedAt:   time.Now(),
		}
		res := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "invite_id"}, {Name: "user_id"}},
			DoNothing: true,
		}).Create(&usage)
		if res.Error != nil {
			return res.Error
		}
		newUsage := res.RowsAffected > 0

		// Re-check exhaustion now that we've claimed (or not) a usage slot —
		// guards against TOCTOU when MaxUses is set and concurrent redeems race.
		if newUsage && invite.MaxUses != nil {
			var current models.LibraryInvite
			if err := tx.Select("use_count, max_uses").Where("id = ?", invite.ID).First(&current).Error; err != nil {
				return err
			}
			if current.UseCount >= *current.MaxUses {
				return ErrExhausted
			}
		}

		// Membership: skip if already member.
		var memberCount int64
		tx.Model(&models.LibraryMember{}).
			Where("library_id = ? AND user_id = ?", invite.LibraryID, userID).
			Count(&memberCount)
		if memberCount == 0 {
			member := models.LibraryMember{
				LibraryID: invite.LibraryID,
				UserID:    userID,
				Role:      "viewer",
			}
			if err := tx.Create(&member).Error; err != nil {
				return err
			}
		}

		// Bump use_count only on first-time redemption.
		if newUsage {
			if err := tx.Model(&models.LibraryInvite{}).
				Where("id = ?", invite.ID).
				UpdateColumn("use_count", gorm.Expr("use_count + 1")).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
