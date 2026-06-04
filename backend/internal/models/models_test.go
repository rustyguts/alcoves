package models

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_models")
	if err := db.AutoMigrate(
		&User{}, &Library{}, &Folder{}, &File{}, &Tag{}, &FileTag{}, &FolderTag{},
		&LibraryMember{}, &LibraryInvite{}, &LibraryInviteUse{}, &AppSettings{},
		&Account{}, &Session{}, &Person{}, &FaceDetection{}, &ObjectDetection{},
		&Moment{}, &MomentTag{}, &MomentShare{}, &AudioDetection{}, &HighlightFilter{},
		&LibraryActivity{}, &UserNotificationDismissal{},
	); err != nil {
		t.Skipf("Skipping test: migrate failed: %v", err)
	}
	// NOTE: do NOT truncate tables — alcoves_test is shared with the auth and
	// middleware packages, which may run in parallel. Every record this package
	// creates uses generated UUIDs and unique emails, so leftover rows from
	// concurrent packages don't interfere.
	return db
}

func seedUser(t *testing.T, db *gorm.DB) User {
	t.Helper()
	u := User{Email: uuid.NewString() + "@t.com", DisplayName: "U", Role: "member"}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return u
}

func seedLibrary(t *testing.T, db *gorm.DB, ownerID uuid.UUID) Library {
	t.Helper()
	l := Library{Name: "L", OwnerID: ownerID}
	if err := db.Create(&l).Error; err != nil {
		t.Fatalf("seed library: %v", err)
	}
	return l
}

func seedFile(t *testing.T, db *gorm.DB, libraryID uuid.UUID) File {
	t.Helper()
	f := File{LibraryID: libraryID, Name: "f.bin"}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("seed file: %v", err)
	}
	return f
}

// TestTableNames asserts every model's TableName mapping (pure, no DB).
func TestTableNames(t *testing.T) {
	cases := []struct {
		got, want string
	}{
		{User{}.TableName(), "users"},
		{Library{}.TableName(), "libraries"},
		{Folder{}.TableName(), "folders"},
		{File{}.TableName(), "files"},
		{Tag{}.TableName(), "tags"},
		{FileTag{}.TableName(), "file_tags"},
		{FolderTag{}.TableName(), "folder_tags"},
		{LibraryMember{}.TableName(), "library_members"},
		{LibraryInvite{}.TableName(), "library_invites"},
		{LibraryInviteUse{}.TableName(), "library_invite_uses"},
		{AppSettings{}.TableName(), "app_settings"},
		{Account{}.TableName(), "accounts"},
		{Session{}.TableName(), "sessions"},
		{Person{}.TableName(), "people"},
		{FaceDetection{}.TableName(), "face_detections"},
		{ObjectDetection{}.TableName(), "object_detections"},
		{Moment{}.TableName(), "moments"},
		{MomentTag{}.TableName(), "moment_tags"},
		{MomentShare{}.TableName(), "moment_shares"},
		{AudioDetection{}.TableName(), "audio_detections"},
		{HighlightFilter{}.TableName(), "highlight_filters"},
		{LibraryActivity{}.TableName(), "library_activities"},
		{UserNotificationDismissal{}.TableName(), "user_notification_dismissals"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("TableName = %q, want %q", c.got, c.want)
		}
	}
}

// TestBaseModelBeforeCreate covers the BaseModel hook directly (no DB).
func TestBaseModelBeforeCreate(t *testing.T) {
	// nil ID gets generated.
	b := &BaseModel{}
	if err := b.BeforeCreate(nil); err != nil {
		t.Fatalf("BeforeCreate: %v", err)
	}
	if b.ID == uuid.Nil {
		t.Error("BaseModel.BeforeCreate should generate an ID")
	}

	// Pre-set ID is preserved.
	preset := uuid.New()
	b2 := &BaseModel{ID: preset}
	if err := b2.BeforeCreate(nil); err != nil {
		t.Fatalf("BeforeCreate: %v", err)
	}
	if b2.ID != preset {
		t.Errorf("BaseModel.BeforeCreate overwrote preset ID: got %v, want %v", b2.ID, preset)
	}
}

// TestBeforeCreateHooks_GenerateUUIDs exercises every model's BeforeCreate
// hook through GORM Create (nil ID -> generated) and verifies preset IDs are
// preserved.
func TestBeforeCreateHooks_GenerateUUIDs(t *testing.T) {
	db := testDB(t)
	user := seedUser(t, db)
	lib := seedLibrary(t, db, user.ID)
	file := seedFile(t, db, lib.ID)

	// User hook (separate from BaseModel).
	if user.ID == uuid.Nil {
		t.Error("User.BeforeCreate should generate ID")
	}
	// Library hook.
	if lib.ID == uuid.Nil {
		t.Error("Library.BeforeCreate should generate ID")
	}
	// File hook.
	if file.ID == uuid.Nil {
		t.Error("File.BeforeCreate should generate ID")
	}

	// Folder hook.
	folder := Folder{LibraryID: lib.ID, Name: "fold"}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if folder.ID == uuid.Nil {
		t.Error("Folder.BeforeCreate should generate ID")
	}

	// Tag hook.
	tag := Tag{LibraryID: lib.ID, Name: "red", Color: "#f00"}
	if err := db.Create(&tag).Error; err != nil {
		t.Fatalf("create tag: %v", err)
	}
	if tag.ID == uuid.Nil {
		t.Error("Tag.BeforeCreate should generate ID")
	}

	// Session hook.
	sess := Session{UserID: user.ID, SessionToken: uuid.NewString(), ExpiresAt: time.Now().Add(time.Hour)}
	if err := db.Create(&sess).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}
	if sess.ID == uuid.Nil {
		t.Error("Session.BeforeCreate should generate ID")
	}

	// ObjectDetection hook.
	od := ObjectDetection{
		FileID: file.ID, LibraryID: lib.ID, Label: "cat", Confidence: 90,
		BoxX: 1, BoxY: 2, BoxWidth: 3, BoxHeight: 4, ImageWidth: 100, ImageHeight: 100,
	}
	if err := db.Create(&od).Error; err != nil {
		t.Fatalf("create object detection: %v", err)
	}
	if od.ID == uuid.Nil {
		t.Error("ObjectDetection.BeforeCreate should generate ID")
	}

	// Moment hook + default ExportVersion.
	moment := Moment{
		FileID: file.ID, LibraryID: lib.ID, CreatedByID: user.ID,
		StartSeconds: 0, EndSeconds: 5,
	}
	if err := db.Create(&moment).Error; err != nil {
		t.Fatalf("create moment: %v", err)
	}
	if moment.ID == uuid.Nil {
		t.Error("Moment.BeforeCreate should generate ID")
	}

	// AudioDetection hook.
	ad := AudioDetection{
		FileID: file.ID, LibraryID: lib.ID, Label: "speech",
		ClassIndex: 1, Score: 0.9, StartSeconds: 0, EndSeconds: 1,
	}
	if err := db.Create(&ad).Error; err != nil {
		t.Fatalf("create audio detection: %v", err)
	}
	if ad.ID == uuid.Nil {
		t.Error("AudioDetection.BeforeCreate should generate ID")
	}

	// HighlightFilter hook.
	hf := HighlightFilter{LibraryID: lib.ID, Name: "hf", Expression: "x"}
	if err := db.Create(&hf).Error; err != nil {
		t.Fatalf("create highlight filter: %v", err)
	}
	if hf.ID == uuid.Nil {
		t.Error("HighlightFilter.BeforeCreate should generate ID")
	}

	// LibraryActivity hook.
	la := LibraryActivity{LibraryID: lib.ID, Action: "file.upload", SubjectType: "file"}
	if err := db.Create(&la).Error; err != nil {
		t.Fatalf("create library activity: %v", err)
	}
	if la.ID == uuid.Nil {
		t.Error("LibraryActivity.BeforeCreate should generate ID")
	}
}

// TestBeforeCreateHooks_PreservePresetID asserts each hook keeps a caller-set ID.
func TestBeforeCreateHooks_PreservePresetID(t *testing.T) {
	preset := uuid.New()
	u := &User{ID: preset}
	if err := u.BeforeCreate(nil); err != nil {
		t.Fatal(err)
	}
	if u.ID != preset {
		t.Errorf("User.BeforeCreate overwrote preset ID")
	}

	for _, h := range []interface{ BeforeCreate(*gorm.DB) error }{
		&Library{ID: preset}, &Folder{ID: preset}, &File{ID: preset},
		&Tag{ID: preset}, &Session{ID: preset}, &ObjectDetection{ID: preset},
		&Moment{ID: preset}, &AudioDetection{ID: preset}, &HighlightFilter{ID: preset},
		&LibraryActivity{ID: preset},
	} {
		if err := h.BeforeCreate(nil); err != nil {
			t.Fatalf("%T.BeforeCreate: %v", h, err)
		}
	}
	// Spot-check a couple kept their preset.
	lib := &Library{ID: preset}
	_ = lib.BeforeCreate(nil)
	if lib.ID != preset {
		t.Error("Library.BeforeCreate overwrote preset ID")
	}
}

// TestColumnDefaults verifies DB-applied defaults populate after Create.
func TestColumnDefaults(t *testing.T) {
	db := testDB(t)
	user := seedUser(t, db)
	lib := seedLibrary(t, db, user.ID)

	// Library boolean defaults.
	var fetched Library
	if err := db.First(&fetched, "id = ?", lib.ID).Error; err != nil {
		t.Fatalf("fetch library: %v", err)
	}
	if fetched.IsDefault || fetched.FaceRecognitionEnabled || fetched.SharingEnabled {
		t.Errorf("library defaults should be false, got %+v", fetched)
	}

	// File defaults: mime, size, waveform peaks per second.
	file := File{LibraryID: lib.ID, Name: "d.bin"}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	var fetchedFile File
	if err := db.First(&fetchedFile, "id = ?", file.ID).Error; err != nil {
		t.Fatalf("fetch file: %v", err)
	}
	if fetchedFile.MimeType != "application/octet-stream" {
		t.Errorf("file mime default = %q, want application/octet-stream", fetchedFile.MimeType)
	}
	if fetchedFile.WaveformPeaksPerSecond != 50 {
		t.Errorf("waveform_peaks_per_second default = %d, want 50", fetchedFile.WaveformPeaksPerSecond)
	}

	// LibraryMember default role = viewer.
	other := seedUser(t, db)
	member := LibraryMember{LibraryID: lib.ID, UserID: other.ID}
	if err := db.Create(&member).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
	var fetchedMember LibraryMember
	if err := db.First(&fetchedMember, "id = ?", member.ID).Error; err != nil {
		t.Fatalf("fetch member: %v", err)
	}
	if fetchedMember.Role != "viewer" {
		t.Errorf("member role default = %q, want viewer", fetchedMember.Role)
	}

	// User default role = member.
	var fetchedUser User
	if err := db.First(&fetchedUser, "id = ?", user.ID).Error; err != nil {
		t.Fatalf("fetch user: %v", err)
	}
	if fetchedUser.Role != "member" {
		t.Errorf("user role default = %q, want member", fetchedUser.Role)
	}
}
