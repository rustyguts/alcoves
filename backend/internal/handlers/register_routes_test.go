package handlers

import (
	"testing"

	"github.com/labstack/echo/v4"
)

// freshGroup returns a brand-new echo group so each handler registers its
// routes on a clean router (avoids duplicate-route panics across handlers).
func freshGroup() *echo.Group {
	return echo.New().Group("/api")
}

// TestRegisterRoutes_AllHandlers exercises every handler's RegisterRoutes
// method. These are pure route-wiring functions that take no dependencies on
// the handler fields, so zero-value handlers are sufficient. This guards
// against accidental route-registration breakage and covers the otherwise
// untested wiring.
func TestRegisterRoutes_AllHandlers(t *testing.T) {
	(&FileHandler{}).RegisterRoutes(freshGroup())
	(&FolderHandler{}).RegisterRoutes(freshGroup())
	(&TagHandler{}).RegisterRoutes(freshGroup())
	(&PeopleHandler{}).RegisterRoutes(freshGroup())
	(&ObjectsHandler{}).RegisterRoutes(freshGroup())
	(&SearchHandler{}).RegisterRoutes(freshGroup())
	(&AvatarHandler{}).RegisterRoutes(freshGroup())
	(&HighlightFilterHandler{}).RegisterRoutes(freshGroup())
	(&MomentHandler{}).RegisterRoutes(freshGroup())
	(&LibraryHandler{}).RegisterRoutes(freshGroup())
	(&MemberHandler{}).RegisterRoutes(freshGroup())
	(&AdminHandler{}).RegisterRoutes(freshGroup())
	(&OAuthHandler{}).RegisterRoutes(freshGroup())
	(&InviteHandler{}).RegisterRoutes(freshGroup())
	(&ShareHandler{}).RegisterRoutes(freshGroup())
	(&DownloadHandler{}).RegisterRoutes(freshGroup())
	(&FileProxyHandler{}).RegisterRoutes(freshGroup())
	(&TusHandler{}).RegisterRoutes(freshGroup())

	// AdminJobs needs a non-nil owner middleware (used in g.Use).
	noop := func(next echo.HandlerFunc) echo.HandlerFunc { return next }
	(&AdminJobsHandler{ownerMW: noop}).RegisterRoutes(freshGroup())

	// Auth registers two groups.
	ah := &AuthHandler{}
	ah.RegisterRoutes(freshGroup())
	ah.RegisterSessionRoute(freshGroup())

	// Notifications registers global + library route sets.
	nh := &NotificationsHandler{}
	nh.RegisterGlobalRoutes(freshGroup())
	nh.RegisterLibraryRoutes(freshGroup())
}
