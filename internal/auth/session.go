package auth

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/config"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
	"golang.org/x/crypto/bcrypt"
)

const sessionDuration = 1 * 24 * time.Hour

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func VerifyPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func GenerateKey(length int, prefix string) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(bytes), nil
}

func SetSessionCookie(c echo.Context, value string) {
	cookie := &http.Cookie{
		Name:     config.SessionCookieName,
		Value:    value,
		MaxAge:   int(sessionDuration.Seconds()),
		Path:     "/",
		Domain:   c.Request().Host,
		Secure:   c.Scheme() == "https",
		HttpOnly: true,
	}
	c.SetCookie(cookie)
}

func InvalidateSessionCookie(c echo.Context) {
	cookie := &http.Cookie{
		Name:     config.SessionCookieName,
		Value:    "",
		Path:     "/",
		Domain:   c.Request().Host,
		MaxAge:   -1,
		Secure:   c.Scheme() == "https",
		HttpOnly: true,
	}
	c.SetCookie(cookie)
}

func CreateSession(c echo.Context, userID uint) (models.Session, error) {
	sessionID, err := GenerateKey(16, "")
	if err != nil {
		c.Logger().Errorf("Failed to generate session key: %v", err)
		return models.Session{}, err
	}

	session := models.Session{
		UserID:    userID,
		SessionID: sessionID,
		IPAddress: c.RealIP(),
		UserAgent: c.Request().UserAgent(),
		ExpiresAt: time.Now().Add(sessionDuration),
	}

	result := db.Connection.Create(&session)
	if result.Error != nil {
		c.Logger().Errorf("Failed to create session: %v", result.Error)
		return models.Session{}, result.Error
	}

	SetSessionCookie(c, session.SessionID)
	return session, nil
}

func InvalidateSession(c echo.Context) error {
	InvalidateSessionCookie(c)

	cookie, err := c.Cookie(config.SessionCookieName)
	if err != nil {
		c.Logger().Errorf("Failed to get session cookie: %v", err)
		return err
	}

	result := db.Connection.Where("session_id = ?", cookie.Value).Delete(&models.Session{})
	if result.Error != nil {
		c.Logger().Errorf("Failed to invalidate session: %v", result.Error)
		return err
	}

	return nil
}

func GetSession(c echo.Context) (*models.Session, error) {
	cookie, err := c.Cookie(config.SessionCookieName)
	if err != nil {
		return nil, err
	}

	var session models.Session
	result := db.Connection.Where("session_id = ?", cookie.Value).First(&session)
	if result.Error != nil {
		return nil, result.Error
	}

	if session.ExpiresAt.Before(time.Now()) {
		// Clean up expired session from database
		db.Connection.Delete(&session)
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "Session expired")
	}

	// Refresh session if it's about to expire (within 2 hours)
	duration := time.Until(session.ExpiresAt)
	if duration < 2*time.Hour {
		slog.Info("Refreshing session due to approaching expiration")
		session.ExpiresAt = time.Now().Add(sessionDuration)
		result = db.Connection.Save(&session)
		if result.Error != nil {
			slog.Error("Failed to refresh session", "error", result.Error)
			return &session, nil // Return session even if refresh failed
		}
		SetSessionCookie(c, session.SessionID)
	}

	return &session, nil
}
