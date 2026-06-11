package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

// NotificationsHandler exposes:
//   - GET    /api/notifications              global bell feed
//   - GET    /api/notifications/unread-count badge value
//   - POST   /api/notifications/:id/dismiss  single-row dismiss
//   - POST   /api/notifications/dismiss-all  watermark dismiss
//   - GET    /api/libraries/:id/feed         per-library feed
//   - GET    /api/ws                         websocket upgrade
//
// The library feed handler is registered under /api/libraries so the
// existing LibraryAccessMiddleware enforces access. The other endpoints
// just need an authenticated user.
type NotificationsHandler struct {
	db          *gorm.DB
	accessSvc   *access.Service
	activitySvc *activity.Service
}

func NewNotificationsHandler(db *gorm.DB, accessSvc *access.Service, activitySvc *activity.Service) *NotificationsHandler {
	return &NotificationsHandler{db: db, accessSvc: accessSvc, activitySvc: activitySvc}
}

// RegisterGlobalRoutes mounts the /api/notifications and /api/ws routes.
// Pass the parent /api group.
func (h *NotificationsHandler) RegisterGlobalRoutes(api *echo.Group) {
	g := api.Group("/notifications")
	g.GET("", h.ListGlobal)
	g.GET("/unread-count", h.UnreadCount)
	g.POST("/:id/dismiss", h.Dismiss)
	g.POST("/dismiss-all", h.DismissAll)

	api.GET("/ws", h.ServeWS)
}

// RegisterLibraryRoutes mounts /api/libraries/:id/feed. Pass the
// /api/libraries group so LibraryAccessMiddleware applies.
func (h *NotificationsHandler) RegisterLibraryRoutes(g *echo.Group) {
	g.GET("/:id/feed", h.ListLibrary)
}

// ---- helpers ----

const defaultLimit = 50
const maxLimit = 100

// cursor is base64(json{createdAt, id}). Mirrors services/files/listing.go.
type cursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        uuid.UUID `json:"id"`
}

func encodeCursor(c cursor) string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(s string) (*cursor, error) {
	if s == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	var c cursor
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

func parseLimit(c echo.Context) int {
	if s := c.QueryParam("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			if n <= 0 {
				return defaultLimit
			}
			if n > maxLimit {
				return maxLimit
			}
			return n
		}
	}
	return defaultLimit
}

// hydrate joins actor + library name + dismissal state.
func (h *NotificationsHandler) hydrate(rows []models.LibraryActivity, userID uuid.UUID) ([]activity.ActivityResponse, error) {
	if len(rows) == 0 {
		return []activity.ActivityResponse{}, nil
	}
	// Collect IDs
	actorIDs := map[uuid.UUID]struct{}{}
	libIDs := map[uuid.UUID]struct{}{}
	activityIDs := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		if r.ActorID != nil {
			actorIDs[*r.ActorID] = struct{}{}
		}
		libIDs[r.LibraryID] = struct{}{}
		activityIDs = append(activityIDs, r.ID)
	}
	// Lookup actors
	actorByID := map[uuid.UUID]models.User{}
	if len(actorIDs) > 0 {
		ids := make([]uuid.UUID, 0, len(actorIDs))
		for id := range actorIDs {
			ids = append(ids, id)
		}
		var users []models.User
		if err := h.db.Select("id, display_name, avatar_url").Where("id IN ?", ids).Find(&users).Error; err != nil {
			return nil, err
		}
		for _, u := range users {
			actorByID[u.ID] = u
		}
	}
	// Lookup library names
	libNameByID := map[uuid.UUID]string{}
	if len(libIDs) > 0 {
		ids := make([]uuid.UUID, 0, len(libIDs))
		for id := range libIDs {
			ids = append(ids, id)
		}
		var libs []models.Library
		if err := h.db.Select("id, name").Where("id IN ?", ids).Find(&libs).Error; err != nil {
			return nil, err
		}
		for _, l := range libs {
			libNameByID[l.ID] = l.Name
		}
	}
	// Lookup dismissals
	dismissed := map[uuid.UUID]bool{}
	if userID != uuid.Nil && len(activityIDs) > 0 {
		var ds []models.UserNotificationDismissal
		if err := h.db.Where("user_id = ? AND activity_id IN ?", userID, activityIDs).Find(&ds).Error; err != nil {
			return nil, err
		}
		for _, d := range ds {
			dismissed[d.ActivityID] = true
		}
	}
	out := make([]activity.ActivityResponse, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		var actor *models.User
		if r.ActorID != nil {
			if u, ok := actorByID[*r.ActorID]; ok {
				actor = &u
			}
		}
		out = append(out, activity.ToResponse(r, actor, libNameByID[r.LibraryID], dismissed[r.ID]))
	}
	return out, nil
}

// accessibleLibraryIDs returns every library the user can see (owned + member of).
func (h *NotificationsHandler) accessibleLibraryIDs(userID uuid.UUID) ([]uuid.UUID, error) {
	var owned []uuid.UUID
	if err := h.db.Model(&models.Library{}).Where("owner_id = ?", userID).Pluck("id", &owned).Error; err != nil {
		return nil, err
	}
	var member []uuid.UUID
	if err := h.db.Model(&models.LibraryMember{}).Where("user_id = ?", userID).Pluck("library_id", &member).Error; err != nil {
		return nil, err
	}
	seen := make(map[uuid.UUID]struct{}, len(owned)+len(member))
	out := make([]uuid.UUID, 0, len(owned)+len(member))
	for _, id := range owned {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	for _, id := range member {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	return out, nil
}

// ---- handlers ----

// ListLibrary returns the per-library Feed. Includes the viewer's own
// actions and system events; no dismissal filtering.
func (h *NotificationsHandler) ListLibrary(c echo.Context) error {
	libIDStr := c.Param("id")
	libID, err := uuid.Parse(libIDStr)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid library id")
	}
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	limit := parseLimit(c)
	cur, err := decodeCursor(c.QueryParam("cursor"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid cursor")
	}

	q := h.db.Where("library_id = ?", libID).
		Order("created_at DESC").Order("id DESC").
		Limit(limit + 1)
	if cur != nil {
		q = q.Where("(created_at, id) < (?, ?)", cur.CreatedAt, cur.ID)
	}
	var rows []models.LibraryActivity
	if err := q.Find(&rows).Error; err != nil {
		return internalError(err.Error(), err)
	}
	var nextCursor *string
	if len(rows) > limit {
		last := rows[limit-1]
		s := encodeCursor(cursor{CreatedAt: last.CreatedAt, ID: last.ID})
		nextCursor = &s
		rows = rows[:limit]
	}
	hydrated, err := h.hydrate(rows, userID)
	if err != nil {
		return internalError(err.Error(), err)
	}
	return c.JSON(http.StatusOK, map[string]any{
		"entries":    hydrated,
		"nextCursor": nextCursor,
	})
}

// ListGlobal returns the global bell feed: cross-library activity in
// libraries the user can access, excluding the user's own actions and
// system events, filtered by the watermark + dismissals.
func (h *NotificationsHandler) ListGlobal(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	limit := parseLimit(c)
	cur, err := decodeCursor(c.QueryParam("cursor"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid cursor")
	}

	libIDs, err := h.accessibleLibraryIDs(userID)
	if err != nil {
		return internalError(err.Error(), err)
	}

	// Empty result early-out: avoid generating IN () which Postgres rejects.
	if len(libIDs) == 0 {
		return c.JSON(http.StatusOK, map[string]any{
			"entries":     []activity.ActivityResponse{},
			"nextCursor":  nil,
			"unreadCount": 0,
		})
	}

	watermark, err := h.userWatermark(userID)
	if err != nil {
		return internalError(err.Error(), err)
	}

	rows, nextCursor, err := h.queryGlobalFeed(userID, libIDs, watermark, cur, limit)
	if err != nil {
		return internalError(err.Error(), err)
	}
	hydrated, err := h.hydrate(rows, userID)
	if err != nil {
		return internalError(err.Error(), err)
	}
	unread, err := h.unreadCountFor(userID, libIDs, watermark)
	if err != nil {
		return internalError(err.Error(), err)
	}
	return c.JSON(http.StatusOK, map[string]any{
		"entries":     hydrated,
		"nextCursor":  nextCursor,
		"unreadCount": unread,
	})
}

// UnreadCount is the lightweight badge endpoint.
func (h *NotificationsHandler) UnreadCount(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	libIDs, err := h.accessibleLibraryIDs(userID)
	if err != nil {
		return internalError(err.Error(), err)
	}
	if len(libIDs) == 0 {
		return c.JSON(http.StatusOK, map[string]any{"unreadCount": 0})
	}
	watermark, err := h.userWatermark(userID)
	if err != nil {
		return internalError(err.Error(), err)
	}
	n, err := h.unreadCountFor(userID, libIDs, watermark)
	if err != nil {
		return internalError(err.Error(), err)
	}
	return c.JSON(http.StatusOK, map[string]any{"unreadCount": n})
}

// Dismiss inserts a dismissal row idempotently.
func (h *NotificationsHandler) Dismiss(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	actID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid activity id")
	}
	// Confirm the activity exists + the user has access to its library.
	var row models.LibraryActivity
	if err := h.db.Select("id, library_id").Where("id = ?", actID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "not found")
		}
		return internalError(err.Error(), err)
	}
	acc, err := h.accessSvc.GetLibraryAccess(userID, row.LibraryID)
	if err != nil || acc == nil {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	// ON CONFLICT DO NOTHING via raw insert clause.
	d := models.UserNotificationDismissal{UserID: userID, ActivityID: actID, DismissedAt: time.Now()}
	res := h.db.Exec(
		`INSERT INTO user_notification_dismissals (user_id, activity_id, dismissed_at) VALUES (?, ?, ?) ON CONFLICT (user_id, activity_id) DO NOTHING`,
		d.UserID, d.ActivityID, d.DismissedAt,
	)
	if res.Error != nil {
		return internalError(res.Error.Error(), res.Error)
	}
	return c.NoContent(http.StatusNoContent)
}

// DismissAll advances the per-user watermark to now().
func (h *NotificationsHandler) DismissAll(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	now := time.Now()
	if err := h.db.Model(&models.User{}).Where("id = ?", userID).
		Update("notifications_cleared_before", now).Error; err != nil {
		return internalError(err.Error(), err)
	}
	return c.NoContent(http.StatusNoContent)
}

// ServeWS upgrades to a websocket. AuthMiddleware has already validated
// the session cookie by this point.
func (h *NotificationsHandler) ServeWS(c echo.Context) error {
	if h.activitySvc == nil || h.activitySvc.Hub() == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "websocket disabled")
	}
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	conn, err := websocket.Accept(c.Response(), c.Request(), &websocket.AcceptOptions{
		InsecureSkipVerify: true, // origin already enforced by Echo CORS
	})
	if err != nil {
		return err
	}
	client := activity.NewClient(userID, conn)
	// Block in the handler: Echo's per-request context is cancelled as soon
	// as we return, which would tear the connection down immediately. We
	// derive a fresh context from the request connection so the read/write
	// pumps live for the lifetime of the WS.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client.Serve(ctx, h.activitySvc.Hub(), h.accessSvc)
	return nil
}

// ---- internal queries ----

func (h *NotificationsHandler) userWatermark(userID uuid.UUID) (*time.Time, error) {
	var u models.User
	if err := h.db.Select("notifications_cleared_before").Where("id = ?", userID).First(&u).Error; err != nil {
		return nil, err
	}
	return u.NotificationsClearedBefore, nil
}

func (h *NotificationsHandler) queryGlobalFeed(userID uuid.UUID, libIDs []uuid.UUID, watermark *time.Time, cur *cursor, limit int) ([]models.LibraryActivity, *string, error) {
	q := h.db.Model(&models.LibraryActivity{}).
		Where("library_id IN ?", libIDs).
		Where("actor_id IS NOT NULL AND actor_id <> ?", userID).
		Where("action NOT LIKE 'system.%'").
		Order("created_at DESC").Order("id DESC").
		Limit(limit + 1)
	if watermark != nil {
		q = q.Where("created_at > ?", *watermark)
	}
	q = q.Where("NOT EXISTS (SELECT 1 FROM user_notification_dismissals d WHERE d.user_id = ? AND d.activity_id = library_activities.id)", userID)
	if cur != nil {
		q = q.Where("(created_at, id) < (?, ?)", cur.CreatedAt, cur.ID)
	}
	var rows []models.LibraryActivity
	if err := q.Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	var nextCursor *string
	if len(rows) > limit {
		last := rows[limit-1]
		s := encodeCursor(cursor{CreatedAt: last.CreatedAt, ID: last.ID})
		nextCursor = &s
		rows = rows[:limit]
	}
	return rows, nextCursor, nil
}

func (h *NotificationsHandler) unreadCountFor(userID uuid.UUID, libIDs []uuid.UUID, watermark *time.Time) (int64, error) {
	q := h.db.Model(&models.LibraryActivity{}).
		Where("library_id IN ?", libIDs).
		Where("actor_id IS NOT NULL AND actor_id <> ?", userID).
		Where("action NOT LIKE 'system.%'").
		Where("NOT EXISTS (SELECT 1 FROM user_notification_dismissals d WHERE d.user_id = ? AND d.activity_id = library_activities.id)", userID)
	if watermark != nil {
		q = q.Where("created_at > ?", *watermark)
	}
	var n int64
	if err := q.Count(&n).Error; err != nil {
		return 0, err
	}
	return n, nil
}

// MemberLookup is the membership-lookup callback the activity Bus uses
// for user-room fan-out. Returns owner + members of a library as string
// UUIDs.
func (h *NotificationsHandler) MemberLookup(libraryIDStr string) ([]string, error) {
	libID, err := uuid.Parse(libraryIDStr)
	if err != nil {
		return nil, err
	}
	var lib models.Library
	if err := h.db.Select("owner_id").Where("id = ?", libID).First(&lib).Error; err != nil {
		return nil, err
	}
	var members []models.LibraryMember
	if err := h.db.Select("user_id").Where("library_id = ?", libID).Find(&members).Error; err != nil {
		return nil, err
	}
	out := make([]string, 0, len(members)+1)
	out = append(out, lib.OwnerID.String())
	seen := map[uuid.UUID]struct{}{lib.OwnerID: {}}
	for _, m := range members {
		if _, ok := seen[m.UserID]; ok {
			continue
		}
		seen[m.UserID] = struct{}{}
		out = append(out, m.UserID.String())
	}
	return out, nil
}

