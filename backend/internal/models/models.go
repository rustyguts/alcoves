package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BeforeCreate hook to auto-generate UUIDs for all models with ID field.
type BaseModel struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	CreatedAt time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`
}

func (b *BaseModel) BeforeCreate(tx *gorm.DB) error {
	if b.ID == uuid.Nil {
		b.ID = uuid.New()
	}
	return nil
}

// User maps to the "users" table.
type User struct {
	ID           uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	Email        string    `gorm:"column:email;type:text;not null;uniqueIndex" json:"email"`
	PasswordHash *string   `gorm:"column:password_hash;type:text" json:"-"`
	DisplayName  string    `gorm:"column:display_name;type:text;not null" json:"displayName"`
	AvatarUrl    *string   `gorm:"column:avatar_url;type:text" json:"avatarUrl"`
	Role         string    `gorm:"column:role;type:text;not null;default:member" json:"role"`
	CreatedAt    time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt    time.Time `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`
}

func (User) TableName() string { return "users" }

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	return nil
}

// Library maps to the "libraries" table.
type Library struct {
	ID                     uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	Name                   string    `gorm:"column:name;type:text;not null" json:"name"`
	Emoji                  *string   `gorm:"column:emoji;type:text" json:"emoji"`
	IsDefault              bool      `gorm:"column:is_default;not null;default:false" json:"isDefault"`
	FaceRecognitionEnabled bool      `gorm:"column:face_recognition_enabled;not null;default:false" json:"faceRecognitionEnabled"`
	ObjectDetectionEnabled bool      `gorm:"column:object_detection_enabled;not null;default:false" json:"objectDetectionEnabled"`
	OwnerID                uuid.UUID `gorm:"column:owner_id;type:uuid;not null" json:"ownerId"`
	CreatedAt              time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt              time.Time `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`

	Owner *User `gorm:"foreignKey:OwnerID" json:"-"`
}

func (Library) TableName() string { return "libraries" }

func (l *Library) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	return nil
}

// Folder maps to the "folders" table.
type Folder struct {
	ID             uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	LibraryID      uuid.UUID  `gorm:"column:library_id;type:uuid;not null;index:folders_library_trash_parent_name_idx" json:"libraryId"`
	ParentFolderID *uuid.UUID `gorm:"column:parent_folder_id;type:uuid;index:folders_library_trash_parent_name_idx" json:"parentFolderId"`
	OwnerID        *uuid.UUID `gorm:"column:owner_id;type:uuid;index:folders_owner_id_idx" json:"ownerId"`
	Name           string     `gorm:"column:name;type:text;not null;index:folders_library_trash_parent_name_idx" json:"name"`
	TrashedAt      *time.Time `gorm:"column:trashed_at;index:folders_library_trash_parent_name_idx" json:"trashedAt"`
	CreatedAt      time.Time  `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt      time.Time  `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`

	Library *Library `gorm:"foreignKey:LibraryID" json:"-"`
	Owner   *User    `gorm:"foreignKey:OwnerID" json:"-"`
	Tags    []Tag    `gorm:"many2many:folder_tags;foreignKey:ID;joinForeignKey:folder_id;References:ID;joinReferences:tag_id" json:"tags,omitempty"`
}

func (Folder) TableName() string { return "folders" }

func (f *Folder) BeforeCreate(tx *gorm.DB) error {
	if f.ID == uuid.Nil {
		f.ID = uuid.New()
	}
	return nil
}

// File maps to the "files" table.
type File struct {
	ID                uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	LibraryID         uuid.UUID  `gorm:"column:library_id;type:uuid;not null;index:files_library_parent_trash_name_idx" json:"libraryId"`
	ParentFolderID    *uuid.UUID `gorm:"column:parent_folder_id;type:uuid;index:files_library_parent_trash_name_idx" json:"parentFolderId"`
	Name              string     `gorm:"column:name;type:text;not null;index:files_library_parent_trash_name_idx" json:"name"`
	MimeType          string     `gorm:"column:mime_type;type:text;not null;default:application/octet-stream" json:"mimeType"`
	Size              int64      `gorm:"column:size;type:bigint;not null;default:0" json:"size"`
	OwnerID           *uuid.UUID `gorm:"column:owner_id;type:uuid;index:files_owner_id_idx" json:"ownerId"`
	Duration          *int       `gorm:"column:duration;type:integer" json:"duration"`
	Width             *int       `gorm:"column:width;type:integer" json:"width"`
	Height            *int       `gorm:"column:height;type:integer" json:"height"`
	ProxyStatus       *string    `gorm:"column:proxy_status;type:text" json:"proxyStatus"`
	ProxyProgress     *int       `gorm:"column:proxy_progress;type:integer" json:"proxyProgress"`
	ProxyEtaSeconds   *int       `gorm:"column:proxy_eta_seconds;type:integer" json:"proxyEtaSeconds"`
	ThumbnailFileID   *uuid.UUID `gorm:"column:thumbnail_file_id;type:uuid" json:"thumbnailFileId"`
	SourceFileID      *uuid.UUID `gorm:"column:source_file_id;type:uuid" json:"sourceFileId"`
	OriginalCreatedAt *time.Time `gorm:"column:original_created_at" json:"originalCreatedAt"`
	TrashedAt         *time.Time `gorm:"column:trashed_at;index:files_library_parent_trash_name_idx" json:"trashedAt"`
	CreatedAt         time.Time  `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt         time.Time  `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`

	Library *Library `gorm:"foreignKey:LibraryID" json:"-"`
	Owner   *User    `gorm:"foreignKey:OwnerID" json:"-"`
	Tags    []Tag    `gorm:"many2many:file_tags;foreignKey:ID;joinForeignKey:file_id;References:ID;joinReferences:tag_id" json:"tags,omitempty"`
}

func (File) TableName() string { return "files" }

func (f *File) BeforeCreate(tx *gorm.DB) error {
	if f.ID == uuid.Nil {
		f.ID = uuid.New()
	}
	return nil
}

// Tag maps to the "tags" table.
type Tag struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	LibraryID uuid.UUID `gorm:"column:library_id;type:uuid;not null;uniqueIndex:tags_library_name_idx;index:tags_library_color_idx" json:"libraryId"`
	Name      string    `gorm:"column:name;type:text;not null;uniqueIndex:tags_library_name_idx" json:"name"`
	Color     string    `gorm:"column:color;type:text;not null;index:tags_library_color_idx" json:"color"`
	CreatedAt time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`
}

func (Tag) TableName() string { return "tags" }

func (t *Tag) BeforeCreate(tx *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	return nil
}

// FileTag maps to the "file_tags" junction table.
type FileTag struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	FileID    uuid.UUID `gorm:"column:file_id;type:uuid;not null;uniqueIndex:file_tags_file_tag_idx" json:"fileId"`
	TagID     uuid.UUID `gorm:"column:tag_id;type:uuid;not null;uniqueIndex:file_tags_file_tag_idx" json:"tagId"`
	CreatedAt time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
}

func (FileTag) TableName() string { return "file_tags" }

// FolderTag maps to the "folder_tags" junction table.
type FolderTag struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	FolderID  uuid.UUID `gorm:"column:folder_id;type:uuid;not null;uniqueIndex:folder_tags_folder_tag_idx" json:"folderId"`
	TagID     uuid.UUID `gorm:"column:tag_id;type:uuid;not null;uniqueIndex:folder_tags_folder_tag_idx" json:"tagId"`
	CreatedAt time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
}

func (FolderTag) TableName() string { return "folder_tags" }

// LibraryMember maps to the "library_members" table.
type LibraryMember struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	LibraryID uuid.UUID `gorm:"column:library_id;type:uuid;not null;uniqueIndex:library_members_library_user_idx" json:"libraryId"`
	UserID    uuid.UUID `gorm:"column:user_id;type:uuid;not null;uniqueIndex:library_members_library_user_idx" json:"userId"`
	Role      string    `gorm:"column:role;type:text;not null;default:viewer" json:"role"`
	CreatedAt time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`

	Library *Library `gorm:"foreignKey:LibraryID" json:"-"`
	User    *User    `gorm:"foreignKey:UserID" json:"-"`
}

func (LibraryMember) TableName() string { return "library_members" }

// LibraryInvite maps to the "library_invites" table.
type LibraryInvite struct {
	ID               uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	LibraryID        uuid.UUID  `gorm:"column:library_id;type:uuid;not null;index:library_invites_library_idx" json:"libraryId"`
	InvitedByUserID  uuid.UUID  `gorm:"column:invited_by_user_id;type:uuid;not null;index:library_invites_inviter_idx" json:"invitedByUserId"`
	InvitedEmail     *string    `gorm:"column:invited_email;type:text;index:library_invites_email_idx" json:"invitedEmail"`
	Role             string     `gorm:"column:role;type:text;not null;default:viewer" json:"role"`
	Token            string     `gorm:"column:token;type:text;not null;uniqueIndex" json:"token"`
	UseCount         int        `gorm:"column:use_count;not null;default:0" json:"useCount"`
	AcceptedByUserID *uuid.UUID `gorm:"column:accepted_by_user_id;type:uuid" json:"acceptedByUserId"`
	AcceptedAt       *time.Time `gorm:"column:accepted_at" json:"acceptedAt"`
	ExpiresAt        *time.Time `gorm:"column:expires_at" json:"expiresAt"`
	RevokedAt        *time.Time `gorm:"column:revoked_at" json:"revokedAt"`
	CreatedAt        time.Time  `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt        time.Time  `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`

	Library   *Library `gorm:"foreignKey:LibraryID" json:"-"`
	InvitedBy *User    `gorm:"foreignKey:InvitedByUserID" json:"-"`
}

func (LibraryInvite) TableName() string { return "library_invites" }

// Account maps to the "accounts" table (OAuth linkage).
type Account struct {
	ID                uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID            uuid.UUID `gorm:"column:user_id;type:uuid;not null" json:"userId"`
	Provider          string    `gorm:"column:provider;type:text;not null;uniqueIndex:accounts_provider_account_idx" json:"provider"`
	ProviderAccountID string    `gorm:"column:provider_account_id;type:text;not null;uniqueIndex:accounts_provider_account_idx" json:"providerAccountId"`
	CreatedAt         time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`

	User *User `gorm:"foreignKey:UserID" json:"-"`
}

func (Account) TableName() string { return "accounts" }

// Session maps to the "sessions" table (DB-backed sessions).
type Session struct {
	ID           uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID       uuid.UUID `gorm:"column:user_id;type:uuid;not null" json:"userId"`
	SessionToken string    `gorm:"column:session_token;type:text;not null;uniqueIndex" json:"sessionToken"`
	UserAgent    *string   `gorm:"column:user_agent;type:text" json:"userAgent"`
	IPAddress    *string   `gorm:"column:ip_address;type:text" json:"ipAddress"`
	CreatedAt    time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	ExpiresAt    time.Time `gorm:"column:expires_at;not null" json:"expiresAt"`

	User *User `gorm:"foreignKey:UserID" json:"-"`
}

func (Session) TableName() string { return "sessions" }

func (s *Session) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

// Person maps to the "people" table (face recognition).
type Person struct {
	ID                   uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	LibraryID            uuid.UUID  `gorm:"column:library_id;type:uuid;not null;index:people_library_id_idx;index:people_library_name_idx" json:"libraryId"`
	Name                 *string    `gorm:"column:name;type:text;index:people_library_name_idx" json:"name"`
	CoverFaceDetectionID *uuid.UUID `gorm:"column:cover_face_detection_id;type:uuid" json:"coverFaceDetectionId"`
	FaceCount            int        `gorm:"column:face_count;not null;default:0" json:"faceCount"`
	CreatedAt            time.Time  `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt            time.Time  `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`

	Library *Library `gorm:"foreignKey:LibraryID" json:"-"`
}

func (Person) TableName() string { return "people" }

// FaceDetection maps to the "face_detections" table.
type FaceDetection struct {
	ID           uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	FileID       uuid.UUID  `gorm:"column:file_id;type:uuid;not null;index:face_detections_file_id_idx" json:"fileId"`
	LibraryID    uuid.UUID  `gorm:"column:library_id;type:uuid;not null;index:face_detections_library_id_idx" json:"libraryId"`
	PersonID     *uuid.UUID `gorm:"column:person_id;type:uuid;index:face_detections_person_id_idx" json:"personId"`
	BoxX         int        `gorm:"column:box_x;not null" json:"boxX"`
	BoxY         int        `gorm:"column:box_y;not null" json:"boxY"`
	BoxWidth     int        `gorm:"column:box_width;not null" json:"boxWidth"`
	BoxHeight    int        `gorm:"column:box_height;not null" json:"boxHeight"`
	ImageWidth   int        `gorm:"column:image_width;not null" json:"imageWidth"`
	ImageHeight  int        `gorm:"column:image_height;not null" json:"imageHeight"`
	Confidence   int        `gorm:"column:confidence;not null" json:"confidence"`
	QualityScore *int       `gorm:"column:quality_score" json:"qualityScore"`
	// Embedding stored as pgvector vector(512) — handled via raw SQL when needed
	CreatedAt time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`

	File    *File    `gorm:"foreignKey:FileID" json:"-"`
	Library *Library `gorm:"foreignKey:LibraryID" json:"-"`
	Person  *Person  `gorm:"foreignKey:PersonID" json:"-"`
}

func (FaceDetection) TableName() string { return "face_detections" }

// ObjectDetection maps to the "object_detections" table.
type ObjectDetection struct {
	ID          uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	FileID      uuid.UUID `gorm:"column:file_id;type:uuid;not null;index:object_detections_file_id_idx" json:"fileId"`
	LibraryID   uuid.UUID `gorm:"column:library_id;type:uuid;not null;index:object_detections_library_id_idx;index:object_detections_label_idx" json:"libraryId"`
	Label       string    `gorm:"column:label;type:text;not null;index:object_detections_label_idx" json:"label"`
	Confidence  int       `gorm:"column:confidence;not null" json:"confidence"`
	BoxX        int       `gorm:"column:box_x;not null" json:"boxX"`
	BoxY        int       `gorm:"column:box_y;not null" json:"boxY"`
	BoxWidth    int       `gorm:"column:box_width;not null" json:"boxWidth"`
	BoxHeight   int       `gorm:"column:box_height;not null" json:"boxHeight"`
	ImageWidth  int       `gorm:"column:image_width;not null" json:"imageWidth"`
	ImageHeight int       `gorm:"column:image_height;not null" json:"imageHeight"`
	CreatedAt   time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`

	File    *File    `gorm:"foreignKey:FileID" json:"-"`
	Library *Library `gorm:"foreignKey:LibraryID" json:"-"`
}

func (ObjectDetection) TableName() string { return "object_detections" }

func (o *ObjectDetection) BeforeCreate(tx *gorm.DB) error {
	if o.ID == uuid.Nil {
		o.ID = uuid.New()
	}
	return nil
}
