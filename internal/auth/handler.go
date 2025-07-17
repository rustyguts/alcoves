package auth

import (
	"log"
	"net/http"
	"net/mail"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
	"github.com/rustyguts/alcoves/internal/user"
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

	return c.Render(http.StatusOK, "login", echo.Map{
		"title": "Login",
	})
}

func GetRegister(c echo.Context) error {
	// If the user is already logged in, redirect to home
	session, err := GetSession(c)
	if err == nil && session != nil {
		return c.Redirect(http.StatusFound, "/")
	}

	return c.Render(http.StatusOK, "register", echo.Map{
		"title": "Register",
	})
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
		return c.Render(http.StatusBadRequest, "register", echo.Map{
			"title":  "Register",
			"Errors": formErrors,
			"Email":  email,
		})
	}

	existingUser, err := user.FindUserByEmail(email)
	if err != nil {
		log.Println("Failed to check existing user", "error", err, "email", email)
		return c.String(http.StatusInternalServerError, "Failed to check existing user")
	}
	if existingUser != nil {
		log.Println("User already exists", "email", email)
		return c.String(http.StatusInternalServerError, "User already exists")
	}

	hashedPassword, err := HashPassword(insecurePassword)
	if err != nil {
		log.Println("Failed to hash password", "error", err)
		return c.String(http.StatusInternalServerError, "Failed to create user")
	}

	user := models.User{
		Email:    email,
		Password: hashedPassword,
	}

	if err := db.Connection.Create(&user).Error; err != nil {
		log.Println("Failed to create user in database", "error", err, "email", email)
		return c.String(http.StatusInternalServerError, "Failed to create user")
	}

	_, err = CreateSession(c, user.ID)
	if err != nil {
		log.Println("Failed to create user session", "error", err, "user_id", user.ID)
		return c.String(http.StatusInternalServerError, "Failed to create user session")
	}

	return c.Redirect(http.StatusFound, "/")
}

func PostLogin(c echo.Context) error {
	email := c.FormValue("email")
	insecurePassword := c.FormValue("password")

	if !valid(email) {
		return c.String(http.StatusInternalServerError, "Failed to login")
	}

	user, err := user.FindUserByEmail(email)
	if err != nil {
		log.Println("Failed to check existing user", "error", err, "email", email)
		return c.String(http.StatusInternalServerError, "Failed to check existing user")
	}
	if user == nil {
		log.Println("User not found", "email", email)
		return c.String(http.StatusInternalServerError, "Failed to login")
	}

	passwordVerified := VerifyPassword(insecurePassword, user.Password)

	if !passwordVerified {
		return c.String(http.StatusInternalServerError, "Failed to login")
	}

	_, err = CreateSession(c, user.ID)
	if err != nil {
		log.Println("Failed to create user session", "error", err, "user_id", user.ID)
		return c.String(http.StatusInternalServerError, "Failed to create user session")
	}

	return c.Redirect(http.StatusFound, "/")
}

func PostLogout(c echo.Context) error {
	err := InvalidateSession(c)
	if err != nil {
		// Log the error but don't fail the logout - user might not have a session
		log.Println("Failed to invalidate session", "error", err)
	}
	return c.Redirect(http.StatusFound, "/login")
}
