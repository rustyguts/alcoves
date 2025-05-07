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
		"title":      "Register",
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
	password := c.FormValue("password")
	errors := make(map[string]string)

	if !valid(email) {
		errors["Email"] = "Invalid email address"
	}

	if len(password) < 8 {
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

	// Now we create the user
	// user := &models.User{
	// 	Email:    email,
	// 	Password: password,
	// }
	// if err := db.CreateUser(user); err != nil {
	// 	return c.Status(fiber.StatusInternalServerError).Render("register", fiber.Map{
	// 		"title":      "Register",
	// 		"data_theme": "dark",
	// 		"Errors":     map[string]string{"Email": "Email already exists"},
	// 		"Email":      email,
	// 	})
	// }

	return c.Redirect("/")
}

func PostLogin(c *fiber.Ctx) error {
	sess, err := db.SessionStore.Get(c)
	if err != nil {
		panic(err)
	}
	sess.Set("name", "alcoves")
	sess.Set("user", 1)
	// sess.Set("email", "test")
	// sess.Set("is_admin", true)

	// Save session
	if err := sess.Save(); err != nil {
		panic(err)
	}
	return c.SendString("Logged in")
}
