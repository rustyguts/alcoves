package auth

import (
	"net/http"
	"net/mail"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/rustyguts/alcoves/internal/db"
)

func valid(email string) bool {
	_, err := mail.ParseAddress(email)
	return err == nil
}

func GetLogin(c *gin.Context) {
	c.HTML(http.StatusOK, "login.html", gin.H{
		"title": "Login",
	})
}

func GetRegister(c *gin.Context) {
	c.HTML(http.StatusOK, "register.html", gin.H{
		"title": "Register",
	})
}

func PostRegister(c *gin.Context) {
	email := c.PostForm("email")
	insecure_password := c.PostForm("password")
	errors := make(map[string]string)

	if !valid(email) {
		errors["Email"] = "Invalid email address"
	}

	if len(insecure_password) < 8 {
		errors["Password"] = "Password must be at least 8 characters"
	}

	if len(errors) > 0 {
		c.HTML(http.StatusBadRequest, "register.html", gin.H{
			"title":  "Register",
			"Errors": errors,
			"Email":  email,
		})
		return
	}

	var user User
	db.DBConn.First(&user, "email = ?", email)
	if user.ID != 0 {
		// If user already exists (unlike your original code which had a bug)
		c.String(http.StatusInternalServerError, "Failed to create user")
		return
	}

	hashedPassword, err := HashPassword(insecure_password)
	if err != nil {
		c.String(http.StatusInternalServerError, "Failed to create user")
		return
	}

	user = User{Email: email, Password: hashedPassword}
	if err := db.DBConn.Create(&user).Error; err != nil {
		c.String(http.StatusInternalServerError, "Failed to create user")
		return
	}

	if err := CreateUserSession(c, user); err != nil {
		c.String(http.StatusInternalServerError, "Failed to create user session")
		return
	}

	c.Redirect(http.StatusFound, "/")
}

func PostLogin(c *gin.Context) {
	email := c.PostForm("email")
	insecure_password := c.PostForm("password")

	if !valid(email) {
		c.String(http.StatusInternalServerError, "Failed to login")
		return
	}

	var user User
	db.DBConn.First(&user, "email = ?", email)
	if user.ID == 0 {
		c.String(http.StatusInternalServerError, "Failed to login")
		return
	}

	passwordVerified := VerifyPassword(insecure_password, user.Password)

	if !passwordVerified {
		c.String(http.StatusInternalServerError, "Failed to login")
		return
	}

	if err := CreateUserSession(c, user); err != nil {
		c.String(http.StatusInternalServerError, "Failed to create user session")
		return
	}

	c.Redirect(http.StatusFound, "/")
}

func PostLogout(c *gin.Context) {
	session := sessions.Default(c)
	session.Clear()
	if err := session.Save(); err != nil {
		c.String(http.StatusInternalServerError, "Failed to logout")
		return
	}

	c.Redirect(http.StatusFound, "/login")
}
