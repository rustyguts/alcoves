package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

func notifCtx(method, target string, userID uuid.UUID, paramName, paramValue string) (echo.Context, *httptest.ResponseRecorder) {
	e := newLibEcho()
	req := httptest.NewRequest(method, target, nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if paramName != "" {
		c.SetParamNames(paramName)
		c.SetParamValues(paramValue)
	}
	if userID != uuid.Nil {
		c.Set(middleware.ContextKeyUserID, userID.String())
	}
	return c, rec
}

func TestNotif_ListLibrary_InvalidID(t *testing.T) {
	db := libraryTestDB(t)
	h := newNotificationsHandler(db)
	owner := mustUser(t, db, "n-inv@example.com")
	c, _ := notifCtx(http.MethodGet, "/", owner.ID, "id", "not-a-uuid")
	if httpCode(t, h.ListLibrary(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestNotif_ListLibrary_BadCursor(t *testing.T) {
	db := libraryTestDB(t)
	h := newNotificationsHandler(db)
	owner := mustUser(t, db, "n-cur@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	c, _ := notifCtx(http.MethodGet, "/?cursor=%21%21%21bad", owner.ID, "id", lib.ID.String())
	if httpCode(t, h.ListLibrary(c)) != http.StatusBadRequest {
		t.Fatalf("want 400 (bad cursor)")
	}
}

func TestNotif_ListLibrary_LimitClamps(t *testing.T) {
	db := libraryTestDB(t)
	h := newNotificationsHandler(db)
	owner := mustUser(t, db, "n-lim@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	mustActivity(t, db, lib.ID, &owner.ID, activity.ActionFileCreated, time.Now())
	for _, q := range []string{"?limit=0", "?limit=99999", "?limit=abc"} {
		c, rec := notifCtx(http.MethodGet, "/"+q, owner.ID, "id", lib.ID.String())
		if err := h.ListLibrary(c); err != nil {
			t.Fatalf("ListLibrary %s: %v", q, err)
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("%s want 200", q)
		}
	}
}

func TestNotif_Dismiss_InvalidID(t *testing.T) {
	db := libraryTestDB(t)
	h := newNotificationsHandler(db)
	owner := mustUser(t, db, "n-dinv@example.com")
	c, _ := notifCtx(http.MethodPost, "/", owner.ID, "id", "bad")
	if httpCode(t, h.Dismiss(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestNotif_Dismiss_NotFound(t *testing.T) {
	db := libraryTestDB(t)
	h := newNotificationsHandler(db)
	owner := mustUser(t, db, "n-dnf@example.com")
	c, _ := notifCtx(http.MethodPost, "/", owner.ID, "id", uuid.New().String())
	if httpCode(t, h.Dismiss(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestNotif_Dismiss_NoAccess(t *testing.T) {
	db := libraryTestDB(t)
	h := newNotificationsHandler(db)
	owner := mustUser(t, db, "n-owner2@example.com")
	stranger := mustUser(t, db, "n-stranger@example.com")
	lib := mustLibrary(t, db, owner.ID, "Private", false)
	act := mustActivity(t, db, lib.ID, &owner.ID, activity.ActionFileCreated, time.Now())
	// stranger has no access to lib -> dismiss returns 404
	c, _ := notifCtx(http.MethodPost, "/", stranger.ID, "id", act.ID.String())
	if httpCode(t, h.Dismiss(c)) != http.StatusNotFound {
		t.Fatalf("want 404 (no access)")
	}
}

func TestNotif_Dismiss_Success(t *testing.T) {
	db := libraryTestDB(t)
	h := newNotificationsHandler(db)
	owner := mustUser(t, db, "n-dok@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	act := mustActivity(t, db, lib.ID, &owner.ID, activity.ActionFileCreated, time.Now())
	c, rec := notifCtx(http.MethodPost, "/", owner.ID, "id", act.ID.String())
	if err := h.Dismiss(c); err != nil {
		t.Fatalf("Dismiss: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rec.Code)
	}
}

func TestNotif_UnreadCount_Empty(t *testing.T) {
	db := libraryTestDB(t)
	h := newNotificationsHandler(db)
	stranger := mustUser(t, db, "n-uc-empty@example.com")
	c, rec := notifCtx(http.MethodGet, "/", stranger.ID, "", "")
	if err := h.UnreadCount(c); err != nil {
		t.Fatalf("UnreadCount: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestNotif_ListGlobal_WithEntries(t *testing.T) {
	db := libraryTestDB(t)
	h := newNotificationsHandler(db)
	owner := mustUser(t, db, "n-glob-owner@example.com")
	actor := mustUser(t, db, "n-glob-actor@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	// actor's actions appear in owner's global feed (excludes owner's own)
	mustActivity(t, db, lib.ID, &actor.ID, activity.ActionFileCreated, time.Now().Add(-1*time.Minute))
	mustActivity(t, db, lib.ID, &actor.ID, activity.ActionFolderCreated, time.Now())
	c, rec := notifCtx(http.MethodGet, "/", owner.ID, "", "")
	if err := h.ListGlobal(c); err != nil {
		t.Fatalf("ListGlobal: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestNotif_ListGlobal_BadCursor(t *testing.T) {
	db := libraryTestDB(t)
	h := newNotificationsHandler(db)
	owner := mustUser(t, db, "n-glob-bc@example.com")
	c, _ := notifCtx(http.MethodGet, "/?cursor=%21%21bad", owner.ID, "", "")
	if httpCode(t, h.ListGlobal(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestNotif_ServeWS_Disabled(t *testing.T) {
	db := libraryTestDB(t)
	// activitySvc with nil hub -> ServeWS returns 503
	h := NewNotificationsHandler(db, access.NewService(db), activity.NewService(db, nil, nil))
	owner := mustUser(t, db, "n-ws@example.com")
	c, _ := notifCtx(http.MethodGet, "/", owner.ID, "", "")
	if httpCode(t, h.ServeWS(c)) != http.StatusServiceUnavailable {
		t.Fatalf("want 503")
	}
}
