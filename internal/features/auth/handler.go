package auth

import (
	"net/mail"

	"github.com/gofiber/fiber/v2"
	"github.com/rustyguts/alcoves/internal/db"
)

func valid(email string) bool {
	_, err := mail.ParseAddress(email)
	return err == nil
}

func GetLogin(c *fiber.Ctx) error {
	return c.Render("login", fiber.Map{
		"title":      "Login",
		"data_theme": "dark",
	})
}

func GetRegister(c *fiber.Ctx) error {
	return c.Render("register", fiber.Map{
		"title":      "Register",
		"data_theme": "dark",
	})
}

func PostRegister(c *fiber.Ctx) error {
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
		return c.Status(fiber.StatusBadRequest).Render("register", fiber.Map{
			"title":      "Register",
			"data_theme": "dark",
			"Errors":     errors,
			"Email":      email,
		})
	}

	var user User
	db.DBConn.First(&user, "email = ?", email)
	if user.ID == 0 {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to create user")
	}

	hashedPassword, err := HashPassword(insecure_password)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to create user")
	}

	if err := db.DBConn.Create(&User{Email: email, Password: hashedPassword}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to create user")
	}

	CreateUserSession(c, user)
	return c.Redirect("/")
}

func PostLogin(c *fiber.Ctx) error {
	email := c.FormValue("email")
	insecure_password := c.FormValue("password")

	if !valid(email) {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to login")
	}

	var user User
	db.DBConn.First(&user, "email = ?", email)
	if user.ID == 0 {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to login")
	}

	passwordVerified := VerifyPassword(insecure_password, user.Password)

	if !passwordVerified {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to login")
	}

	CreateUserSession(c, user)
	return c.Redirect("/")
}

func PostLogout(c *fiber.Ctx) error {
	sess, err := db.SessionStore.Get(c)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to get session")
	}
	if err := sess.Destroy(); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to logout")
	}
	return c.Redirect("/login")
}
