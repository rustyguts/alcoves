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
	ID                         uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	Email                      string     `gorm:"column:email;type:text;not null;uniqueIndex" json:"email"`
	PasswordHash               *string    `gorm:"column:password_hash;type:text" json:"-"`
	DisplayName                string     `gorm:"column:display_name;type:text;not null" json:"displayName"`
	AvatarUrl                  *string    `gorm:"column:avatar_url;type:text" json:"avatarUrl"`
	Role                       string     `gorm:"column:role;type:text;not null;default:member" json:"role"`
	NotificationsClearedBefore *time.Time `gorm:"column:notifications_cleared_before" json:"-"`
	CreatedAt                  time.Time  `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt                  time.Time  `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`
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
	SharingEnabled         bool      `gorm:"column:sharing_enabled;not null;default:false" json:"sharingEnabled"`
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
	ID                     uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	LibraryID              uuid.UUID  `gorm:"column:library_id;type:uuid;not null;index:files_library_parent_trash_name_idx" json:"libraryId"`
	ParentFolderID         *uuid.UUID `gorm:"column:parent_folder_id;type:uuid;index:files_library_parent_trash_name_idx" json:"parentFolderId"`
	Name                   string     `gorm:"column:name;type:text;not null;index:files_library_parent_trash_name_idx" json:"name"`
	MimeType               string     `gorm:"column:mime_type;type:text;not null;default:application/octet-stream" json:"mimeType"`
	Size                   int64      `gorm:"column:size;type:bigint;not null;default:0" json:"size"`
	OwnerID                *uuid.UUID `gorm:"column:owner_id;type:uuid;index:files_owner_id_idx" json:"ownerId"`
	Duration               *int       `gorm:"column:duration;type:integer" json:"duration"`
	Width                  *int       `gorm:"column:width;type:integer" json:"width"`
	Height                 *int       `gorm:"column:height;type:integer" json:"height"`
	ProxyStatus            *string    `gorm:"column:proxy_status;type:text" json:"proxyStatus"`
	ProxyProgress          *int       `gorm:"column:proxy_progress;type:integer" json:"proxyProgress"`
	ProxyEtaSeconds        *int       `gorm:"column:proxy_eta_seconds;type:integer" json:"proxyEtaSeconds"`
	TranscribeStatus       *string    `gorm:"column:transcribe_status;type:text" json:"transcribeStatus"`
	TranscribeProgress     *int       `gorm:"column:transcribe_progress;type:integer" json:"transcribeProgress"`
	TranscribeEtaSeconds   *int       `gorm:"column:transcribe_eta_seconds;type:integer" json:"transcribeEtaSeconds"`
	TranscribeError        *string    `gorm:"column:transcribe_error;type:text" json:"transcribeError"`
	TranscribeVersion      int        `gorm:"column:transcribe_version;type:integer;not null;default:0" json:"transcribeVersion"`
	TranscribedVersion     *int       `gorm:"column:transcribed_version;type:integer" json:"transcribedVersion"`
	TranscriptText         *string    `gorm:"column:transcript_text;type:text" json:"transcriptText,omitempty"`
	TranscriptVTT          *string    `gorm:"column:transcript_vtt;type:text" json:"transcriptVtt,omitempty"`
	TranscriptModel        *string    `gorm:"column:transcript_model;type:text" json:"transcriptModel"`
	AudioDetectStatus      *string    `gorm:"column:audio_detect_status;type:text" json:"audioDetectStatus"`
	AudioDetectProgress    *int       `gorm:"column:audio_detect_progress;type:integer" json:"audioDetectProgress"`
	AudioDetectEtaSeconds  *int       `gorm:"column:audio_detect_eta_seconds;type:integer" json:"audioDetectEtaSeconds"`
	AudioDetectError       *string    `gorm:"column:audio_detect_error;type:text" json:"audioDetectError"`
	AudioDetectVersion     int        `gorm:"column:audio_detect_version;type:integer;not null;default:0" json:"audioDetectVersion"`
	AudioDetectedVersion   *int       `gorm:"column:audio_detected_version;type:integer" json:"audioDetectedVersion"`
	AudioDetectModel       *string    `gorm:"column:audio_detect_model;type:text" json:"audioDetectModel"`
	WaveformStatus         *string    `gorm:"column:waveform_status;type:text" json:"waveformStatus"`
	WaveformProgress       *int       `gorm:"column:waveform_progress;type:integer" json:"waveformProgress"`
	WaveformError          *string    `gorm:"column:waveform_error;type:text" json:"waveformError"`
	WaveformVersion        int        `gorm:"column:waveform_version;type:integer;not null;default:0" json:"waveformVersion"`
	WaveformedVersion      *int       `gorm:"column:waveformed_version;type:integer" json:"waveformedVersion"`
	WaveformPeaksPerSecond int        `gorm:"column:waveform_peaks_per_second;type:integer;not null;default:50" json:"waveformPeaksPerSecond"`
	ThumbnailFileID        *uuid.UUID `gorm:"column:thumbnail_file_id;type:uuid" json:"thumbnailFileId"`
	SourceFileID           *uuid.UUID `gorm:"column:source_file_id;type:uuid" json:"sourceFileId"`
	OriginalCreatedAt      *time.Time `gorm:"column:original_created_at" json:"originalCreatedAt"`
	Hash                   *string    `gorm:"column:hash;type:text" json:"hash"`
	TrashedAt              *time.Time `gorm:"column:trashed_at;index:files_library_parent_trash_name_idx" json:"trashedAt"`
	CreatedAt              time.Time  `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt              time.Time  `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`

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
	ID              uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	LibraryID       uuid.UUID  `gorm:"column:library_id;type:uuid;not null;index:library_invites_library_idx" json:"libraryId"`
	InvitedByUserID uuid.UUID  `gorm:"column:invited_by_user_id;type:uuid;not null;index:library_invites_inviter_idx" json:"invitedByUserId"`
	Token           string     `gorm:"column:token;type:text;not null;uniqueIndex" json:"token"`
	MaxUses         *int       `gorm:"column:max_uses" json:"maxUses"`
	UseCount        int        `gorm:"column:use_count;not null;default:0" json:"useCount"`
	ExpiresAt       *time.Time `gorm:"column:expires_at" json:"expiresAt"`
	RevokedAt       *time.Time `gorm:"column:revoked_at" json:"revokedAt"`
	CreatedAt       time.Time  `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt       time.Time  `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`

	Library   *Library           `gorm:"foreignKey:LibraryID" json:"-"`
	InvitedBy *User              `gorm:"foreignKey:InvitedByUserID" json:"-"`
	Uses      []LibraryInviteUse `gorm:"foreignKey:InviteID" json:"-"`
}

func (LibraryInvite) TableName() string { return "library_invites" }

// LibraryInviteUse records each redemption of an invite link.
type LibraryInviteUse struct {
	ID       uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	InviteID uuid.UUID `gorm:"column:invite_id;type:uuid;not null;uniqueIndex:library_invite_uses_invite_user_idx" json:"inviteId"`
	UserID   uuid.UUID `gorm:"column:user_id;type:uuid;not null;uniqueIndex:library_invite_uses_invite_user_idx" json:"userId"`
	UsedAt   time.Time `gorm:"column:used_at;not null;default:now()" json:"usedAt"`

	Invite *LibraryInvite `gorm:"foreignKey:InviteID" json:"-"`
	User   *User          `gorm:"foreignKey:UserID" json:"-"`
}

func (LibraryInviteUse) TableName() string { return "library_invite_uses" }

// AppSettings is a single-row table holding global app configuration.
type AppSettings struct {
	ID        int        `gorm:"column:id;primaryKey" json:"id"`
	Settings  []byte     `gorm:"column:settings;type:jsonb;not null;default:'{}'::jsonb" json:"-"`
	UpdatedAt time.Time  `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`
	UpdatedBy *uuid.UUID `gorm:"column:updated_by;type:uuid" json:"updatedBy"`
}

func (AppSettings) TableName() string { return "app_settings" }

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

// PersonalAccessToken is a long-lived bearer credential (used by the MCP
// server and future integrations). Only the SHA-256 hash of the token is
// stored; the plaintext is returned once at creation. A nil ExpiresAt never
// expires.
type PersonalAccessToken struct {
	ID         uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID     uuid.UUID  `gorm:"column:user_id;type:uuid;not null;index:personal_access_tokens_user_id_idx" json:"userId"`
	TokenHash  string     `gorm:"column:token_hash;type:text;not null;uniqueIndex" json:"-"`
	Name       string     `gorm:"column:name;type:text;not null" json:"name"`
	LastUsedAt *time.Time `gorm:"column:last_used_at" json:"lastUsedAt"`
	ExpiresAt  *time.Time `gorm:"column:expires_at" json:"expiresAt"`
	CreatedAt  time.Time  `gorm:"column:created_at;not null;default:now()" json:"createdAt"`

	User *User `gorm:"foreignKey:UserID" json:"-"`
}

func (PersonalAccessToken) TableName() string { return "personal_access_tokens" }

func (p *PersonalAccessToken) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
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

// Moment maps to the "moments" table — a named time range on a video file.
type Moment struct {
	ID               uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	FileID           uuid.UUID  `gorm:"column:file_id;type:uuid;not null;index:moments_file_idx" json:"fileId"`
	LibraryID        uuid.UUID  `gorm:"column:library_id;type:uuid;not null;index:moments_library_idx" json:"libraryId"`
	CreatedByID      uuid.UUID  `gorm:"column:created_by_id;type:uuid;not null" json:"createdById"`
	Name             string     `gorm:"column:name;type:text;not null;default:''" json:"name"`
	Description      string     `gorm:"column:description;type:text;not null;default:''" json:"description"`
	StartSeconds     float64    `gorm:"column:start_seconds;type:numeric(12,3);not null" json:"startSeconds"`
	EndSeconds       float64    `gorm:"column:end_seconds;type:numeric(12,3);not null" json:"endSeconds"`
	ExportStatus     *string    `gorm:"column:export_status;type:text" json:"exportStatus"`
	ExportProgress   *int       `gorm:"column:export_progress" json:"exportProgress"`
	ExportEtaSeconds *int       `gorm:"column:export_eta_seconds" json:"exportEtaSeconds"`
	ExportVersion    int        `gorm:"column:export_version;not null;default:1" json:"exportVersion"`
	ExportedVersion  *int       `gorm:"column:exported_version" json:"exportedVersion"`
	TrashedAt        *time.Time `gorm:"column:trashed_at" json:"trashedAt"`
	CreatedAt        time.Time  `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt        time.Time  `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`

	File      *File    `gorm:"foreignKey:FileID" json:"-"`
	Library   *Library `gorm:"foreignKey:LibraryID" json:"-"`
	CreatedBy *User    `gorm:"foreignKey:CreatedByID" json:"-"`
}

func (Moment) TableName() string { return "moments" }

func (m *Moment) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}

// MomentTag links a moment to a library tag.
type MomentTag struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	MomentID  uuid.UUID `gorm:"column:moment_id;type:uuid;not null;uniqueIndex:moment_tags_moment_tag_idx" json:"momentId"`
	TagID     uuid.UUID `gorm:"column:tag_id;type:uuid;not null;uniqueIndex:moment_tags_moment_tag_idx;index:moment_tags_tag_idx" json:"tagId"`
	CreatedAt time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
}

func (MomentTag) TableName() string { return "moment_tags" }

// MomentShare is a public share link for a moment.
type MomentShare struct {
	ID          uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	MomentID    uuid.UUID  `gorm:"column:moment_id;type:uuid;not null;index:moment_shares_moment_idx" json:"momentId"`
	LibraryID   uuid.UUID  `gorm:"column:library_id;type:uuid;not null" json:"libraryId"`
	CreatedByID uuid.UUID  `gorm:"column:created_by_id;type:uuid;not null" json:"createdById"`
	Token       string     `gorm:"column:token;type:text;not null;uniqueIndex:moment_shares_token_idx" json:"token"`
	RevokedAt   *time.Time `gorm:"column:revoked_at" json:"revokedAt"`
	CreatedAt   time.Time  `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
}

func (MomentShare) TableName() string { return "moment_shares" }

// AudioDetection represents a single tagged sound event detected in a file's audio track.
type AudioDetection struct {
	ID           uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	FileID       uuid.UUID `gorm:"column:file_id;type:uuid;not null;index:audio_detections_file_id_idx" json:"fileId"`
	LibraryID    uuid.UUID `gorm:"column:library_id;type:uuid;not null;index:audio_detections_library_id_idx" json:"libraryId"`
	Label        string    `gorm:"column:label;type:text;not null" json:"label"`
	ClassIndex   int       `gorm:"column:class_index;type:integer;not null" json:"classIndex"`
	Score        float32   `gorm:"column:score;type:real;not null" json:"score"`
	StartSeconds float32   `gorm:"column:start_seconds;type:real;not null" json:"startSeconds"`
	EndSeconds   float32   `gorm:"column:end_seconds;type:real;not null" json:"endSeconds"`
	Version      int       `gorm:"column:version;type:integer;not null;default:1" json:"version"`
	CreatedAt    time.Time `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
}

func (AudioDetection) TableName() string { return "audio_detections" }

func (a *AudioDetection) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}

// HighlightFilter is a per-library named rule that turns transcript / audio
// detection signals into matchable highlights. The match logic is encoded as
// a small expression language; see the frontend parser for grammar.
type HighlightFilter struct {
	ID               uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	LibraryID        uuid.UUID  `gorm:"column:library_id;type:uuid;not null;index:highlight_filters_library_idx" json:"libraryId"`
	CreatedByID      *uuid.UUID `gorm:"column:created_by_id;type:uuid" json:"createdById"`
	Name             string     `gorm:"column:name;type:text;not null" json:"name"`
	Expression       string     `gorm:"column:expression;type:text;not null" json:"expression"`
	ProximitySeconds int        `gorm:"column:proximity_seconds;type:integer;not null;default:5" json:"proximitySeconds"`
	Color            string     `gorm:"column:color;type:text;not null;default:'#3B82F6'" json:"color"`
	CreatedAt        time.Time  `gorm:"column:created_at;not null;default:now()" json:"createdAt"`
	UpdatedAt        time.Time  `gorm:"column:updated_at;not null;default:now()" json:"updatedAt"`
}

func (HighlightFilter) TableName() string { return "highlight_filters" }

func (h *HighlightFilter) BeforeCreate(tx *gorm.DB) error {
	if h.ID == uuid.Nil {
		h.ID = uuid.New()
	}
	return nil
}

// LibraryActivity is the canonical activity log row. Inserted by
// services/activity.Service.Emit. The bell feed is derived
// (this table + UserNotificationDismissal + users.notifications_cleared_before).
//
// Metadata is JSONB. Schema varies per action; see services/activity/actions.go.
// Subject names are snapshotted into metadata so renaming or deleting the
// underlying entity doesn't break renderers.
type LibraryActivity struct {
	ID          uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	LibraryID   uuid.UUID  `gorm:"column:library_id;type:uuid;not null;index:library_activities_library_created_idx,priority:1" json:"libraryId"`
	ActorID     *uuid.UUID `gorm:"column:actor_id;type:uuid;index:library_activities_actor_created_idx,priority:1" json:"actorId"`
	Action      string     `gorm:"column:action;type:text;not null" json:"action"`
	SubjectType string     `gorm:"column:subject_type;type:text;not null;index:library_activities_subject_idx,priority:1" json:"subjectType"`
	SubjectID   *uuid.UUID `gorm:"column:subject_id;type:uuid;index:library_activities_subject_idx,priority:2" json:"subjectId"`
	Metadata    []byte     `gorm:"column:metadata;type:jsonb;not null;default:'{}'::jsonb" json:"-"`
	CreatedAt   time.Time  `gorm:"column:created_at;not null;default:now();index:library_activities_library_created_idx,priority:2,sort:desc;index:library_activities_actor_created_idx,priority:3,sort:desc" json:"createdAt"`

	Library *Library `gorm:"foreignKey:LibraryID" json:"-"`
	Actor   *User    `gorm:"foreignKey:ActorID" json:"-"`
}

func (LibraryActivity) TableName() string { return "library_activities" }

func (a *LibraryActivity) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}

// UserNotificationDismissal records that a user explicitly dismissed a
// specific activity from their global bell view. Sparse — /dismiss-all
// uses a per-user watermark (User.NotificationsClearedBefore) instead.
type UserNotificationDismissal struct {
	UserID      uuid.UUID `gorm:"column:user_id;type:uuid;not null;primaryKey" json:"userId"`
	ActivityID  uuid.UUID `gorm:"column:activity_id;type:uuid;not null;primaryKey" json:"activityId"`
	DismissedAt time.Time `gorm:"column:dismissed_at;not null;default:now()" json:"dismissedAt"`
}

func (UserNotificationDismissal) TableName() string { return "user_notification_dismissals" }
