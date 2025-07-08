package auth

import (
	"net/http"
	"net/mail"

	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
)

func valid(email string) bool {
	_, err := mail.ParseAddress(email)
	return err == nil
}

func GetLogin(c echo.Context) error {
	return c.Render(http.StatusOK, "login.html", map[string]interface{}{
		"title": "Login",
	})
}

func GetRegister(c echo.Context) error {
	return c.Render(http.StatusOK, "register.html", map[string]interface{}{
		"title": "Register",
	})
}

func PostRegister(c echo.Context) error {
	email := c.FormValue("email")
	insecure_password := c.FormValue("password")
	errors := make(map[string]string)

	if !valid(email) {
		errors["Email"] = "Invalid email address"
	}

	if len(insecure_password) < 8 {
		errors["Password"] = "Password must be at least 8 characters"
	}

	if len(errors) > 0 {
		return c.Render(http.StatusBadRequest, "register.html", map[string]interface{}{
			"title":  "Register",
			"Errors": errors,
			"Email":  email,
		})
	}

	var user models.User
	db.DBConn.First(&user, "email = ?", email)
	if user.ID != 0 {
		// If user already exists (unlike your original code which had a bug)
		return c.String(http.StatusInternalServerError, "Failed to create user")
	}

	hashedPassword, err := HashPassword(insecure_password)
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to create user")
	}

	user = models.User{Email: email, Password: hashedPassword}
	if err := db.DBConn.Create(&user).Error; err != nil {
		return c.String(http.StatusInternalServerError, "Failed to create user")
	}

	if err := CreateUserSession(c, user); err != nil {
		return c.String(http.StatusInternalServerError, "Failed to create user session")
	}

	return c.Redirect(http.StatusFound, "/")
}

func PostLogin(c echo.Context) error {
	email := c.FormValue("email")
	insecure_password := c.FormValue("password")

	if !valid(email) {
		return c.String(http.StatusInternalServerError, "Failed to login")
	}

	var user models.User
	db.DBConn.First(&user, "email = ?", email)
	if user.ID == 0 {
		return c.String(http.StatusInternalServerError, "Failed to login")
	}

	passwordVerified := VerifyPassword(insecure_password, user.Password)

	if !passwordVerified {
		return c.String(http.StatusInternalServerError, "Failed to login")
	}

	if err := CreateUserSession(c, user); err != nil {
		return c.String(http.StatusInternalServerError, "Failed to create user session")
	}

	return c.Redirect(http.StatusFound, "/")
}

func PostLogout(c echo.Context) error {
	sess, err := session.Get("session", c)
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to logout")
	}

	// Clear all session values
	for key := range sess.Values {
		delete(sess.Values, key)
	}

	if err := sess.Save(c.Request(), c.Response()); err != nil {
		return c.String(http.StatusInternalServerError, "Failed to logout")
	}

	return c.Redirect(http.StatusFound, "/login")
}
