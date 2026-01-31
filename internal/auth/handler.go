package auth

import (
	"log/slog"
	"net/http"
	"net/mail"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/components"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
)

func valid(email string) bool {
	_, err := mail.ParseAddress(email)
	return err == nil
}

func GetLogin(c echo.Context) error {
	// If the user is already logged in, redirect to home
	session, err := GetSession(c)
	if err == nil && session != nil {
		return c.Redirect(http.StatusFound, "/")
	}

	component := components.Login(components.LoginData{
		Title: "Login",
		Theme: "dark", // Default theme
	})
	return component.Render(c.Request().Context(), c.Response().Writer)
}

func GetRegister(c echo.Context) error {
	// If the user is already logged in, redirect to home
	session, err := GetSession(c)
	if err == nil && session != nil {
		return c.Redirect(http.StatusFound, "/")
	}

	component := components.Register(components.RegisterData{
		Title:  "Register",
		Theme:  "dark", // Default theme
		Email:  "",
		Errors: nil,
	})
	return component.Render(c.Request().Context(), c.Response().Writer)
}

func PostRegister(c echo.Context) error {
	email := c.FormValue("email")
	insecurePassword := c.FormValue("password")
	formErrors := make(map[string]string)

	if !valid(email) {
		formErrors["Email"] = "Invalid email address"
	}

	if len(insecurePassword) < 8 {
		formErrors["Password"] = "Password must be at least 8 characters"
	}

	if len(formErrors) > 0 {
		c.Response().WriteHeader(http.StatusBadRequest)
		component := components.Register(components.RegisterData{
			Title:  "Register",
			Theme:  "dark", // Default theme
			Email:  email,
			Errors: formErrors,
		})
		return component.Render(c.Request().Context(), c.Response().Writer)
	}

	existingUser, err := FindUserByEmail(email)
	if err != nil {
		slog.Error("Failed to check existing user", "error", err, "email", email)
		return c.String(http.StatusInternalServerError, "Failed to check existing user")
	}
	if existingUser != nil {
		slog.Info("User already exists", "email", email)
		return c.String(http.StatusConflict, "User already exists")
	}

	hashedPassword, err := HashPassword(insecurePassword)
	if err != nil {
		slog.Error("Failed to hash password", "error", err)
		return c.String(http.StatusInternalServerError, "Failed to create user")
	}

	user := models.User{
		Email:    email,
		Password: hashedPassword,
	}

	if err := db.Connection.Create(&user).Error; err != nil {
		slog.Error("Failed to create user in database", "error", err, "email", email)
		return c.String(http.StatusInternalServerError, "Failed to create user")
	}

	// Create personal library for the user
	_, err = models.CreatePersonalLibrary(db.Connection, user.ID, email)
	if err != nil {
		slog.Error("Failed to create personal library", "error", err, "user_id", user.ID)
		// Note: We don't fail user creation if library creation fails
		// The user can still use the system, just without their personal library initially
	}

	_, err = CreateSession(c, user.ID)
	if err != nil {
		slog.Error("Failed to create user session", "error", err, "user_id", user.ID)
		return c.String(http.StatusInternalServerError, "Failed to create user session")
	}

	return c.Redirect(http.StatusFound, "/")
}

func PostLogin(c echo.Context) error {
	email := c.FormValue("email")
	insecurePassword := c.FormValue("password")

	if !valid(email) {
		return c.String(http.StatusBadRequest, "Invalid email format")
	}

	foundUser, err := FindUserByEmail(email)
	if err != nil {
		slog.Error("Failed to check existing user", "error", err, "email", email)
		return c.String(http.StatusInternalServerError, "Failed to check existing user")
	}
	if foundUser == nil {
		slog.Info("User not found", "email", email)
		return c.String(http.StatusUnauthorized, "Invalid credentials")
	}

	passwordVerified := VerifyPassword(insecurePassword, foundUser.Password)

	if !passwordVerified {
		return c.String(http.StatusUnauthorized, "Invalid credentials")
	}

	_, err = CreateSession(c, foundUser.ID)
	if err != nil {
		slog.Error("Failed to create user session", "error", err, "user_id", foundUser.ID)
		return c.String(http.StatusInternalServerError, "Failed to create user session")
	}

	return c.Redirect(http.StatusFound, "/")
}

func PostLogout(c echo.Context) error {
	err := InvalidateSession(c)
	if err != nil {
		// Log the error but don't fail the logout - user might not have a session
		slog.Error("Failed to invalidate session", "error", err)
	}
	return c.Redirect(http.StatusFound, "/login")
}
