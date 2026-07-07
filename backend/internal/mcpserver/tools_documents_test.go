package mcpserver

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func mustParseUUID(t *testing.T, s string) uuid.UUID {
	t.Helper()
	id, err := uuid.Parse(s)
	if err != nil {
		t.Fatalf("parse uuid %q: %v", s, err)
	}
	return id
}

func TestDocumentTools_CreateReadUpdateRoundtrip(t *testing.T) {
	fx := setup(t)

	// Create with initial content (name gets .md appended).
	created := decode[documentOutput](t, call(t, fx.deps, fx.userA, "create_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"name":      "Meeting Notes",
		"content":   "# Agenda\n\n- item one\n",
	}))
	if created.Name != "Meeting Notes.md" || created.Live {
		t.Fatalf("created = %+v, want Meeting Notes.md live=false", created)
	}

	// Read it back.
	read := decode[documentOutput](t, call(t, fx.deps, fx.userA, "read_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"fileId":    created.FileID,
	}))
	if read.Markdown != "# Agenda\n\n- item one\n" || read.Live {
		t.Fatalf("read = %+v, want original markdown live=false", read)
	}

	// A viewer can read…
	viewerRead := decode[documentOutput](t, call(t, fx.deps, fx.userC, "read_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"fileId":    created.FileID,
	}))
	if viewerRead.Markdown != read.Markdown {
		t.Fatalf("viewer read = %q, want same markdown", viewerRead.Markdown)
	}

	// …an admin member can update…
	updated := decode[documentOutput](t, call(t, fx.deps, fx.userB, "update_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"fileId":    created.FileID,
		"content":   "# Rewritten by MCP\n",
	}))
	if updated.Size != int64(len("# Rewritten by MCP\n")) {
		t.Fatalf("updated size = %d", updated.Size)
	}
	read = decode[documentOutput](t, call(t, fx.deps, fx.userA, "read_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"fileId":    created.FileID,
	}))
	if read.Markdown != "# Rewritten by MCP\n" {
		t.Fatalf("post-update read = %q", read.Markdown)
	}
}

func TestDocumentTools_UpdateResetsLiveCRDTState(t *testing.T) {
	fx := setup(t)

	created := decode[documentOutput](t, call(t, fx.deps, fx.userA, "create_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"name":      "live.md",
		"content":   "before",
	}))

	// Simulate a live editing session: seed CRDT state through the docs service.
	fileID := mustParseUUID(t, created.FileID)
	if conflicted, _, err := fx.deps.Docs.Init(context.Background(), fx.libShared, fileID, fx.userA.ID, []byte{1}); err != nil || conflicted {
		t.Fatalf("Init: conflicted=%v err=%v", conflicted, err)
	}

	read := decode[documentOutput](t, call(t, fx.deps, fx.userA, "read_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"fileId":    created.FileID,
	}))
	if !read.Live {
		t.Fatal("expected live=true once CRDT state exists")
	}

	// update_document drops the CRDT sidecar so the next open re-seeds.
	decode[documentOutput](t, call(t, fx.deps, fx.userA, "update_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"fileId":    created.FileID,
		"content":   "after",
	}))
	var docCount int64
	fx.deps.DB.Model(&models.Document{}).Where("file_id = ?", fileID).Count(&docCount)
	if docCount != 0 {
		t.Fatalf("doc rows after update = %d, want 0", docCount)
	}
	read = decode[documentOutput](t, call(t, fx.deps, fx.userA, "read_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"fileId":    created.FileID,
	}))
	if read.Markdown != "after" || read.Live {
		t.Fatalf("post-reset read = %+v, want 'after' live=false", read)
	}
}

func TestDocumentTools_AccessAndEligibility(t *testing.T) {
	fx := setup(t)

	// Viewers cannot create or update.
	res := call(t, fx.deps, fx.userC, "create_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"name":      "nope",
	})
	if !res.IsError {
		t.Fatal("viewer create_document should fail")
	}

	created := decode[documentOutput](t, call(t, fx.deps, fx.userA, "create_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"name":      "doc.md",
	}))
	res = call(t, fx.deps, fx.userC, "update_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"fileId":    created.FileID,
		"content":   "x",
	})
	if !res.IsError {
		t.Fatal("viewer update_document should fail")
	}

	// Non-members see neither the library nor the document.
	res = call(t, fx.deps, fx.userB, "read_document", map[string]any{
		"libraryId": fx.libA.String(),
		"fileId":    created.FileID,
	})
	if !res.IsError {
		t.Fatal("non-member read_document should fail")
	}

	// Non-markdown files are rejected.
	png := models.File{LibraryID: fx.libShared, Name: "photo.png", MimeType: "image/png"}
	if err := fx.deps.DB.Create(&png).Error; err != nil {
		t.Fatalf("create png: %v", err)
	}
	res = call(t, fx.deps, fx.userA, "read_document", map[string]any{
		"libraryId": fx.libShared.String(),
		"fileId":    png.ID.String(),
	})
	if !res.IsError {
		t.Fatal("read_document on a png should fail")
	}
}
