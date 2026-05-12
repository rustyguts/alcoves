package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"gorm.io/gorm"
)

// newNotificationsHandler is the test convenience constructor used by
// every assertion below. Hub/Bus are nil — we're only testing the HTTP
// surface.
func newNotificationsHandler(db *gorm.DB) *NotificationsHandler {
	return NewNotificationsHandler(db, access.NewService(db), activity.NewService(db, nil, nil))
}

func mustActivity(t *testing.T, db *gorm.DB, libID uuid.UUID, actorID *uuid.UUID, action string, createdAt time.Time) models.LibraryActivity {
	t.Helper()
	row := models.LibraryActivity{
		LibraryID:   libID,
		ActorID:     actorID,
		Action:      action,
		SubjectType: "file",
		Metadata:    []byte(`{}`),
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("create activity: %v", err)
	}
	if !createdAt.IsZero() {
		// Backdate to test cursor ordering. Use Exec because GORM ignores
		// CreatedAt on Create when defaults are in play.
		db.Exec("UPDATE library_activities SET created_at = ? WHERE id = ?", createdAt, row.ID)
		db.Where("id = ?", row.ID).First(&row)
	}
	return row
}

// TestListLibrary_ReturnsAllEvents: per-library feed includes the viewer's
// own actions and system events.
func TestListLibrary_ReturnsAllEvents(t *testing.T) {
	db := libraryTestDB(t)
	owner := mustUser(t, db, "lib-feed@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)

	now := time.Now()
	a1 := mustActivity(t, db, lib.ID, &owner.ID, activity.ActionFileCreated, now.Add(-3*time.Minute))
	a2 := mustActivity(t, db, lib.ID, nil, activity.ActionSystemWaveformReady, now.Add(-2*time.Minute))
	a3 := mustActivity(t, db, lib.ID, &owner.ID, activity.ActionFolderCreated, now.Add(-1*time.Minute))

	e := newLibEcho()
	h := newNotificationsHandler(db)

	req := httptest.NewRequest(http.MethodGet, "/api/libraries/"+lib.ID.String()+"/feed", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())

	if err := h.ListLibrary(c); err != nil {
		t.Fatalf("ListLibrary: %v", err)
	}
	var resp struct {
		Entries    []activity.ActivityResponse `json:"entries"`
		NextCursor *string                     `json:"nextCursor"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Entries) != 3 {
		t.Fatalf("want 3 entries, got %d", len(resp.Entries))
	}
	// DESC order by created_at: a3, a2, a1
	if resp.Entries[0].ID != a3.ID.String() || resp.Entries[2].ID != a1.ID.String() {
		t.Errorf("ordering wrong: %v", []string{resp.Entries[0].ID, resp.Entries[1].ID, resp.Entries[2].ID})
	}
	// Confirm system events are present here (they're hidden from the global feed but not the library feed).
	hasSystem := false
	for _, e := range resp.Entries {
		if activity.IsSystemAction(e.Action) {
			hasSystem = true
		}
	}
	if !hasSystem {
		t.Error("system events missing from library feed")
	}
	_ = a2
}

// TestListGlobal_ExcludesActorAndSystem: actor exclusion + system filter.
func TestListGlobal_ExcludesActorAndSystem(t *testing.T) {
	db := libraryTestDB(t)
	me := mustUser(t, db, "me@example.com")
	other := mustUser(t, db, "them@example.com")
	lib := mustLibrary(t, db, me.ID, "L", false)
	// Make `other` a member so they show up in accessible-libraries
	// (otherwise me sees nothing because activities require the actor and
	// they're me — actor exclusion takes everything away).
	db.Create(&models.LibraryMember{LibraryID: lib.ID, UserID: other.ID, Role: "viewer"})

	mustActivity(t, db, lib.ID, &me.ID, activity.ActionFileCreated, time.Now())          // my own — excluded
	mustActivity(t, db, lib.ID, nil, activity.ActionSystemWaveformReady, time.Now())     // system — excluded
	visible := mustActivity(t, db, lib.ID, &other.ID, activity.ActionFileCreated, time.Now())

	e := newLibEcho()
	h := newNotificationsHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/api/notifications", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, me.ID.String())

	if err := h.ListGlobal(c); err != nil {
		t.Fatalf("ListGlobal: %v", err)
	}
	var resp struct {
		Entries     []activity.ActivityResponse `json:"entries"`
		UnreadCount int                         `json:"unreadCount"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Entries) != 1 || resp.Entries[0].ID != visible.ID.String() {
		t.Fatalf("expected only `other`'s file.created, got %d entries", len(resp.Entries))
	}
	if resp.UnreadCount != 1 {
		t.Errorf("unreadCount = %d, want 1", resp.UnreadCount)
	}
}

func TestListGlobal_EmptyForUserWithNoAccess(t *testing.T) {
	db := libraryTestDB(t)
	stranger := mustUser(t, db, "stranger@example.com")
	owner := mustUser(t, db, "owner-only@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	mustActivity(t, db, lib.ID, &owner.ID, activity.ActionFileCreated, time.Now())

	e := newLibEcho()
	h := newNotificationsHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/api/notifications", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, stranger.ID.String())

	if err := h.ListGlobal(c); err != nil {
		t.Fatalf("ListGlobal: %v", err)
	}
	var resp struct {
		Entries     []activity.ActivityResponse `json:"entries"`
		UnreadCount int                         `json:"unreadCount"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Entries) != 0 {
		t.Errorf("stranger should see 0 entries, got %d", len(resp.Entries))
	}
	if resp.UnreadCount != 0 {
		t.Errorf("unreadCount = %d, want 0", resp.UnreadCount)
	}
}

func TestDismiss_RemovesFromGlobal(t *testing.T) {
	db := libraryTestDB(t)
	me := mustUser(t, db, "dismisser@example.com")
	other := mustUser(t, db, "actor-d@example.com")
	lib := mustLibrary(t, db, me.ID, "L", false)
	db.Create(&models.LibraryMember{LibraryID: lib.ID, UserID: other.ID, Role: "viewer"})

	a := mustActivity(t, db, lib.ID, &other.ID, activity.ActionFileCreated, time.Now())

	e := newLibEcho()
	h := newNotificationsHandler(db)
	// Dismiss
	req := httptest.NewRequest(http.MethodPost, "/api/notifications/"+a.ID.String()+"/dismiss", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(a.ID.String())
	c.Set(middleware.ContextKeyUserID, me.ID.String())
	if err := h.Dismiss(c); err != nil {
		t.Fatalf("Dismiss: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("dismiss status: %d", rec.Code)
	}

	// Now /notifications must not include it.
	req2 := httptest.NewRequest(http.MethodGet, "/api/notifications", nil)
	rec2 := httptest.NewRecorder()
	c2 := e.NewContext(req2, rec2)
	c2.Set(middleware.ContextKeyUserID, me.ID.String())
	_ = h.ListGlobal(c2)
	var resp struct {
		Entries     []activity.ActivityResponse `json:"entries"`
		UnreadCount int                         `json:"unreadCount"`
	}
	json.Unmarshal(rec2.Body.Bytes(), &resp)
	if len(resp.Entries) != 0 {
		t.Errorf("dismissed entry should be filtered out, got %d", len(resp.Entries))
	}
}

func TestDismiss_IdempotentInsert(t *testing.T) {
	db := libraryTestDB(t)
	me := mustUser(t, db, "dismiss-twice@example.com")
	other := mustUser(t, db, "actor-d2@example.com")
	lib := mustLibrary(t, db, me.ID, "L", false)
	db.Create(&models.LibraryMember{LibraryID: lib.ID, UserID: other.ID, Role: "viewer"})

	a := mustActivity(t, db, lib.ID, &other.ID, activity.ActionFileCreated, time.Now())

	e := newLibEcho()
	h := newNotificationsHandler(db)
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/notifications/"+a.ID.String()+"/dismiss", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id")
		c.SetParamValues(a.ID.String())
		c.Set(middleware.ContextKeyUserID, me.ID.String())
		if err := h.Dismiss(c); err != nil {
			t.Fatalf("Dismiss #%d: %v", i, err)
		}
	}
	var count int64
	db.Model(&models.UserNotificationDismissal{}).Where("user_id = ? AND activity_id = ?", me.ID, a.ID).Count(&count)
	if count != 1 {
		t.Errorf("expected 1 dismissal row after double-dismiss, got %d", count)
	}
}

func TestDismissAll_AdvancesWatermark(t *testing.T) {
	db := libraryTestDB(t)
	me := mustUser(t, db, "dismiss-all@example.com")
	other := mustUser(t, db, "actor-da@example.com")
	lib := mustLibrary(t, db, me.ID, "L", false)
	db.Create(&models.LibraryMember{LibraryID: lib.ID, UserID: other.ID, Role: "viewer"})

	mustActivity(t, db, lib.ID, &other.ID, activity.ActionFileCreated, time.Now().Add(-time.Hour))
	mustActivity(t, db, lib.ID, &other.ID, activity.ActionFileCreated, time.Now().Add(-30*time.Minute))

	e := newLibEcho()
	h := newNotificationsHandler(db)
	req := httptest.NewRequest(http.MethodPost, "/api/notifications/dismiss-all", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, me.ID.String())
	if err := h.DismissAll(c); err != nil {
		t.Fatalf("DismissAll: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("status: %d", rec.Code)
	}
	var u models.User
	if err := db.Where("id = ?", me.ID).First(&u).Error; err != nil {
		t.Fatalf("user reload: %v", err)
	}
	if u.NotificationsClearedBefore == nil {
		t.Fatal("watermark should be set")
	}

	// And /notifications now returns empty + 0 unread.
	req2 := httptest.NewRequest(http.MethodGet, "/api/notifications", nil)
	rec2 := httptest.NewRecorder()
	c2 := e.NewContext(req2, rec2)
	c2.Set(middleware.ContextKeyUserID, me.ID.String())
	_ = h.ListGlobal(c2)
	var resp struct {
		Entries     []activity.ActivityResponse `json:"entries"`
		UnreadCount int                         `json:"unreadCount"`
	}
	json.Unmarshal(rec2.Body.Bytes(), &resp)
	if len(resp.Entries) != 0 || resp.UnreadCount != 0 {
		t.Errorf("after dismiss-all: %d entries, %d unread", len(resp.Entries), resp.UnreadCount)
	}

	// New event after watermark should reappear.
	newRow := mustActivity(t, db, lib.ID, &other.ID, activity.ActionFileCreated, time.Now().Add(time.Hour))
	req3 := httptest.NewRequest(http.MethodGet, "/api/notifications", nil)
	rec3 := httptest.NewRecorder()
	c3 := e.NewContext(req3, rec3)
	c3.Set(middleware.ContextKeyUserID, me.ID.String())
	_ = h.ListGlobal(c3)
	var resp2 struct {
		Entries     []activity.ActivityResponse `json:"entries"`
		UnreadCount int                         `json:"unreadCount"`
	}
	json.Unmarshal(rec3.Body.Bytes(), &resp2)
	if len(resp2.Entries) != 1 || resp2.Entries[0].ID != newRow.ID.String() {
		t.Errorf("post-watermark event missing: got %d entries", len(resp2.Entries))
	}
	if resp2.UnreadCount != 1 {
		t.Errorf("post-watermark unread: %d", resp2.UnreadCount)
	}
}

func TestListLibrary_CursorPagination(t *testing.T) {
	db := libraryTestDB(t)
	owner := mustUser(t, db, "pager@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	now := time.Now()
	for i := 0; i < 5; i++ {
		mustActivity(t, db, lib.ID, &owner.ID, activity.ActionFileCreated, now.Add(-time.Duration(i)*time.Minute))
	}

	e := newLibEcho()
	h := newNotificationsHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/api/libraries/"+lib.ID.String()+"/feed?limit=2", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())
	if err := h.ListLibrary(c); err != nil {
		t.Fatalf("page1: %v", err)
	}
	var page1 struct {
		Entries    []activity.ActivityResponse `json:"entries"`
		NextCursor *string                     `json:"nextCursor"`
	}
	json.Unmarshal(rec.Body.Bytes(), &page1)
	if len(page1.Entries) != 2 {
		t.Fatalf("page1 size: %d", len(page1.Entries))
	}
	if page1.NextCursor == nil {
		t.Fatal("nextCursor should not be nil with 5 total / 2 per page")
	}

	// Page 2 follows.
	req2 := httptest.NewRequest(http.MethodGet, "/api/libraries/"+lib.ID.String()+"/feed?limit=2&cursor="+*page1.NextCursor, nil)
	rec2 := httptest.NewRecorder()
	c2 := e.NewContext(req2, rec2)
	c2.SetParamNames("id")
	c2.SetParamValues(lib.ID.String())
	c2.Set(middleware.ContextKeyUserID, owner.ID.String())
	if err := h.ListLibrary(c2); err != nil {
		t.Fatalf("page2: %v", err)
	}
	var page2 struct {
		Entries    []activity.ActivityResponse `json:"entries"`
		NextCursor *string                     `json:"nextCursor"`
	}
	json.Unmarshal(rec2.Body.Bytes(), &page2)
	if len(page2.Entries) != 2 {
		t.Fatalf("page2 size: %d", len(page2.Entries))
	}
	// First of page2 must NOT equal last of page1.
	if page2.Entries[0].ID == page1.Entries[1].ID {
		t.Errorf("page2 should start after page1's last row")
	}
}

func TestUnreadCount_ReflectsState(t *testing.T) {
	db := libraryTestDB(t)
	me := mustUser(t, db, "counter@example.com")
	other := mustUser(t, db, "actor-c@example.com")
	lib := mustLibrary(t, db, me.ID, "L", false)
	db.Create(&models.LibraryMember{LibraryID: lib.ID, UserID: other.ID, Role: "viewer"})

	for i := 0; i < 3; i++ {
		mustActivity(t, db, lib.ID, &other.ID, activity.ActionFileCreated, time.Now())
	}

	e := newLibEcho()
	h := newNotificationsHandler(db)
	req := httptest.NewRequest(http.MethodGet, "/api/notifications/unread-count", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, me.ID.String())
	if err := h.UnreadCount(c); err != nil {
		t.Fatalf("UnreadCount: %v", err)
	}
	var resp struct {
		UnreadCount int `json:"unreadCount"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.UnreadCount != 3 {
		t.Errorf("unreadCount = %d, want 3", resp.UnreadCount)
	}
}

func TestMemberLookup_ReturnsOwnerPlusMembers(t *testing.T) {
	db := libraryTestDB(t)
	owner := mustUser(t, db, "owner-ml@example.com")
	m1 := mustUser(t, db, "m1@example.com")
	m2 := mustUser(t, db, "m2@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	db.Create(&models.LibraryMember{LibraryID: lib.ID, UserID: m1.ID, Role: "viewer"})
	db.Create(&models.LibraryMember{LibraryID: lib.ID, UserID: m2.ID, Role: "admin"})

	h := newNotificationsHandler(db)
	got, err := h.MemberLookup(lib.ID.String())
	if err != nil {
		t.Fatalf("MemberLookup: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 ids, got %d (%v)", len(got), got)
	}
	// Check the owner is in there.
	found := map[string]bool{}
	for _, id := range got {
		found[id] = true
	}
	for _, want := range []uuid.UUID{owner.ID, m1.ID, m2.ID} {
		if !found[want.String()] {
			t.Errorf("missing %s", want)
		}
	}
}
