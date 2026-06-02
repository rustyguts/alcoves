package handlers

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/labstack/echo/v4"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
)

const (
	oauthStateCookie    = "alcoves-oauth-state"
	oauthStateMaxAgeSec = 600 // 10 minutes
	oauthStateBytes     = 32
)

type OAuthHandler struct {
	db          *gorm.DB
	authSvc     *authservice.Service
	oauthConfig *oauth2.Config
	enabled     bool
}

func NewOAuthHandler(db *gorm.DB, authSvc *authservice.Service, clientID, clientSecret, baseURL string) *OAuthHandler {
	enabled := clientID != "" && clientSecret != ""
	var cfg *oauth2.Config
	if enabled {
		cfg = &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			Endpoint:     google.Endpoint,
			RedirectURL:  baseURL + "/api/auth/google/callback",
			Scopes:       []string{"openid", "email", "profile"},
		}
	}
	return &OAuthHandler{db: db, authSvc: authSvc, oauthConfig: cfg, enabled: enabled}
}

func (h *OAuthHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/google", h.GoogleLogin)
	g.GET("/google/callback", h.GoogleCallback)
}

func (h *OAuthHandler) GoogleLogin(c echo.Context) error {
	if !h.enabled {
		return echo.NewHTTPError(http.StatusNotFound, "Google OAuth is not configured")
	}

	state, err := generateOAuthState()
	if err != nil {
		return c.Redirect(http.StatusFound, "/login?error=oauth_failed")
	}

	c.SetCookie(&http.Cookie{
		Name:     oauthStateCookie,
		Value:    state,
		Path:     "/api/auth",
		HttpOnly: true,
		Secure:   c.Scheme() == "https",
		SameSite: http.SameSiteLaxMode,
		MaxAge:   oauthStateMaxAgeSec,
	})

	url := h.oauthConfig.AuthCodeURL(state)
	return c.Redirect(http.StatusFound, url)
}

func generateOAuthState() (string, error) {
	b := make([]byte, oauthStateBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func clearOAuthStateCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{
		Name:     oauthStateCookie,
		Value:    "",
		Path:     "/api/auth",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

func (h *OAuthHandler) GoogleCallback(c echo.Context) error {
	if !h.enabled {
		return echo.NewHTTPError(http.StatusNotFound, "Google OAuth is not configured")
	}

	stateParam := c.QueryParam("state")
	stateCookie, cookieErr := c.Cookie(oauthStateCookie)
	clearOAuthStateCookie(c)
	if cookieErr != nil || stateParam == "" || stateCookie.Value == "" ||
		subtle.ConstantTimeCompare([]byte(stateParam), []byte(stateCookie.Value)) != 1 {
		return c.Redirect(http.StatusFound, "/login?error=oauth_state")
	}

	code := c.QueryParam("code")
	if code == "" {
		return c.Redirect(http.StatusFound, "/login?error=oauth_failed")
	}

	// Exchange code for token
	token, err := h.oauthConfig.Exchange(c.Request().Context(), code)
	if err != nil {
		return c.Redirect(http.StatusFound, "/login?error=oauth_failed")
	}

	// Get user info from Google
	client := h.oauthConfig.Client(c.Request().Context(), token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return c.Redirect(http.StatusFound, "/login?error=oauth_failed")
	}
	defer resp.Body.Close()

	// Parse Google user info
	var googleUser struct {
		ID      string `json:"id"`
		Email   string `json:"email"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&googleUser); err != nil {
		return c.Redirect(http.StatusFound, "/login?error=oauth_failed")
	}

	// Check if account already linked
	var account models.Account
	err = h.db.Where("provider = ? AND provider_account_id = ?", "google", googleUser.ID).First(&account).Error

	var user models.User
	if err == nil {
		// Existing account — log in
		h.db.Where("id = ?", account.UserID).First(&user)
	} else if errors.Is(err, gorm.ErrRecordNotFound) {
		// Check if user with this email exists
		err = h.db.Where("email = ?", googleUser.Email).First(&user).Error
		isNewUser := errors.Is(err, gorm.ErrRecordNotFound)

		// Wrap user + library + account creation atomically so a failure in any
		// step does not leave orphaned rows.
		txErr := h.db.Transaction(func(tx *gorm.DB) error {
			if isNewUser {
				// Create new user
				var userCount int64
				tx.Model(&models.User{}).Count(&userCount)
				role := "member"
				if userCount == 0 {
					role = "owner"
				}

				user = models.User{
					Email:       googleUser.Email,
					DisplayName: googleUser.Name,
					Role:        role,
				}
				if googleUser.Picture != "" {
					user.AvatarUrl = &googleUser.Picture
				}
				if err := tx.Create(&user).Error; err != nil {
					return fmt.Errorf("create user: %w", err)
				}

				// Create default library
				if err := tx.Create(&models.Library{
					Name:      "My Library",
					IsDefault: true,
					OwnerID:   user.ID,
				}).Error; err != nil {
					return fmt.Errorf("create library: %w", err)
				}
			}

			// Link Google account (runs for both new and email-matched users)
			if err := tx.Create(&models.Account{
				UserID:            user.ID,
				Provider:          "google",
				ProviderAccountID: googleUser.ID,
			}).Error; err != nil {
				return fmt.Errorf("create account: %w", err)
			}

			return nil
		})
		if txErr != nil {
			return c.Redirect(http.StatusFound, "/login?error=oauth_failed")
		}
	} else {
		return c.Redirect(http.StatusFound, "/login?error=oauth_failed")
	}

	// Create session
	sessionToken, err := h.authSvc.CreateSession(user.ID, c)
	if err != nil {
		return c.Redirect(http.StatusFound, "/login?error=session_failed")
	}

	h.authSvc.SetSessionCookie(c, authservice.SessionPayload{
		SessionToken: sessionToken,
		UserID:       user.ID.String(),
	})

	return c.Redirect(http.StatusFound, "/")
}
