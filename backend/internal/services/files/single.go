package files

import (
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// LoadFileOwnerAndTags loads the owner summary and (name-sorted) tags for a
// single file using the same loaders — and therefore the same JSON shapes
// (OwnerSummary / TagResponse) — as the list endpoint's rows. Owner is nil
// when the file has no owner or the user row is gone; tags is never nil.
func LoadFileOwnerAndTags(db *gorm.DB, f *models.File) (*OwnerSummary, []TagResponse) {
	s := NewService(db)

	fileID := f.ID.String()
	tags := s.loadFileTags([]string{fileID})[fileID]
	if tags == nil {
		tags = []TagResponse{}
	}
	sortTags(tags)

	var owner *OwnerSummary
	if f.OwnerID != nil {
		ownerID := f.OwnerID.String()
		if o, ok := s.loadOwners([]string{ownerID})[ownerID]; ok {
			owner = &o
		}
	}
	return owner, tags
}
