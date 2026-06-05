package seed

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// --- small pointer helpers -------------------------------------------------

func sp(s string) *string       { return &s }
func ip(i int) *int             { return &i }
func fp(f float64) *float64     { return &f }
func tp(t time.Time) *time.Time { return &t }
func up(u uuid.UUID) *uuid.UUID { return &u }

// create inserts a row, recording the first error. It is a thin wrapper so the
// content code stays declarative.
func (s *seeder) create(row any) {
	if s.err != nil {
		return
	}
	if err := s.db.Create(row).Error; err != nil {
		s.fail(fmt.Errorf("create %T: %w", row, err))
	}
}

// --- users -----------------------------------------------------------------

func (s *seeder) createUser(idName, email, name, role, avatarAsset string, createdAt time.Time) *models.User {
	if s.err != nil {
		return &models.User{}
	}
	hash, err := authservice.HashPassword(DefaultPassword)
	if err != nil {
		s.fail(fmt.Errorf("hash password: %w", err))
		return &models.User{}
	}
	uid := id(idName)
	u := &models.User{
		BaseModel:    models.BaseModel{ID: uid, CreatedAt: createdAt, UpdatedAt: createdAt},
		Email:        strings.ToLower(email),
		PasswordHash: &hash,
		DisplayName:  name,
		Role:         role,
	}
	if avatarAsset != "" {
		data, aerr := asset(avatarAsset)
		if aerr != nil {
			s.fail(aerr)
			return &models.User{}
		}
		if serr := s.st.StoreAvatar(uid.String(), data); serr != nil {
			s.fail(fmt.Errorf("store avatar for %s: %w", email, serr))
			return &models.User{}
		}
		u.AvatarUrl = sp(fmt.Sprintf("/api/auth/users/%s/avatar", uid.String()))
	}
	s.create(u)
	// A credentials account mirrors what the register flow creates, so password
	// login + account-linkage code paths behave identically to a real signup.
	s.create(&models.Account{
		UserID:            uid,
		Provider:          "credentials",
		ProviderAccountID: strings.ToLower(email),
		CreatedAt:         createdAt,
	})
	if s.err == nil {
		s.res.Users++
	}
	return u
}

// --- libraries -------------------------------------------------------------

func (s *seeder) createLibrary(idName, name, emoji string, isDefault, face, obj, share bool, owner uuid.UUID, createdAt time.Time) *models.Library {
	if s.err != nil {
		return &models.Library{}
	}
	lib := &models.Library{
		BaseModel:              models.BaseModel{ID: id(idName), CreatedAt: createdAt, UpdatedAt: createdAt},
		Name:                   name,
		Emoji:                  sp(emoji),
		IsDefault:              isDefault,
		FaceRecognitionEnabled: face,
		ObjectDetectionEnabled: obj,
		SharingEnabled:         share,
		OwnerID:                owner,
	}
	s.create(lib)
	if s.err == nil {
		s.res.Libraries++
	}
	return lib
}

func (s *seeder) addMember(idName string, lib, user uuid.UUID, role string, createdAt time.Time) {
	s.create(&models.LibraryMember{
		ID:        id(idName),
		LibraryID: lib,
		UserID:    user,
		Role:      role,
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	})
}

// --- folders ---------------------------------------------------------------

func (s *seeder) createFolder(idName string, lib uuid.UUID, parent *uuid.UUID, name string, owner uuid.UUID, createdAt time.Time) *models.Folder {
	if s.err != nil {
		return &models.Folder{}
	}
	f := &models.Folder{
		BaseModel:      models.BaseModel{ID: id(idName), CreatedAt: createdAt, UpdatedAt: createdAt},
		LibraryID:      lib,
		ParentFolderID: parent,
		OwnerID:        up(owner),
		Name:           name,
	}
	s.create(f)
	if s.err == nil {
		s.res.Folders++
	}
	return f
}

// --- tags ------------------------------------------------------------------

func (s *seeder) createTag(idName string, lib uuid.UUID, name, color string, createdAt time.Time) *models.Tag {
	if s.err != nil {
		return &models.Tag{}
	}
	t := &models.Tag{
		BaseModel: models.BaseModel{ID: id(idName), CreatedAt: createdAt, UpdatedAt: createdAt},
		LibraryID: lib,
		Name:      name,
		Color:     color,
	}
	s.create(t)
	if s.err == nil {
		s.res.Tags++
	}
	return t
}

func (s *seeder) tagFile(file, tag uuid.UUID) {
	s.create(&models.FileTag{ID: id("filetag", file.String(), tag.String()), FileID: file, TagID: tag, CreatedAt: s.now})
}

func (s *seeder) tagFolder(folder, tag uuid.UUID) {
	s.create(&models.FolderTag{ID: id("foldertag", folder.String(), tag.String()), FolderID: folder, TagID: tag, CreatedAt: s.now})
}

func (s *seeder) tagMoment(moment, tag uuid.UUID) {
	s.create(&models.MomentTag{ID: id("momenttag", moment.String(), tag.String()), MomentID: moment, TagID: tag, CreatedAt: s.now})
}

// --- files -----------------------------------------------------------------

// fileSpec describes a file to materialize from an embedded asset.
type fileSpec struct {
	idName     string
	lib        uuid.UUID
	parent     *uuid.UUID
	owner      uuid.UUID
	name       string
	assetRel   string // e.g. "images/beach-sunset.jpg"
	mime       string
	width      int // 0 => decode (images)
	height     int
	duration   int    // seconds; videos/audio
	thumbAsset string // webp asset written to the video thumbnail cache key
	capturedAt *time.Time
	gpsLat     *float64
	gpsLon     *float64
	cameraMake *string
	camera     *string // model
	createdAt  time.Time
}

func (s *seeder) addFile(spec fileSpec) *models.File {
	if s.err != nil {
		return &models.File{}
	}
	data, err := asset(spec.assetRel)
	if err != nil {
		s.fail(err)
		return &models.File{}
	}
	fid := id(spec.idName)
	if err := s.st.StoreFile(spec.lib.String(), fid.String(), data); err != nil {
		s.fail(fmt.Errorf("store file blob %s: %w", spec.name, err))
		return &models.File{}
	}

	w, h := spec.width, spec.height
	if strings.HasPrefix(spec.mime, "image/") && w == 0 {
		if dw, dh, derr := imageDims(data); derr == nil {
			w, h = dw, dh
		}
	}

	f := &models.File{
		BaseModel:      models.BaseModel{ID: fid, CreatedAt: spec.createdAt, UpdatedAt: spec.createdAt},
		LibraryID:      spec.lib,
		ParentFolderID: spec.parent,
		Name:           spec.name,
		MimeType:       spec.mime,
		Size:           int64(len(data)),
		OwnerID:        up(spec.owner),
		CapturedAt:     spec.capturedAt,
		GpsLat:         spec.gpsLat,
		GpsLon:         spec.gpsLon,
		CameraMake:     spec.cameraMake,
		CameraModel:    spec.camera,
	}
	if w > 0 {
		f.Width, f.Height = ip(w), ip(h)
	}
	if spec.duration > 0 {
		f.Duration = ip(spec.duration)
	}
	// Mark metadata as already extracted so the backfill maintenance loop
	// doesn't immediately re-enqueue every seeded file.
	if spec.capturedAt != nil || spec.gpsLat != nil {
		f.MetadataStatus = sp("ready")
		f.MetadataVersion = 1
		f.MetadataExtractedVersion = ip(1)
	}
	s.create(f)

	// Videos render a thumbnail from the cache key {lib}/{fileID}/thumbnail.webp.
	if spec.thumbAsset != "" && s.err == nil {
		thumb, terr := asset(spec.thumbAsset)
		if terr != nil {
			s.fail(terr)
			return &models.File{}
		}
		cacheKey := storage.ThumbnailKey(spec.lib.String(), fid.String())
		if serr := s.st.StoreCacheBuffer(cacheKey, thumb); serr != nil {
			s.fail(fmt.Errorf("store thumbnail for %s: %w", spec.name, serr))
			return &models.File{}
		}
	}
	if s.err == nil {
		s.res.Files++
	}
	return f
}
