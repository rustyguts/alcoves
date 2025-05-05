package auth

import (
	"github.com/gofiber/fiber/v2"
	"github.com/rustyguts/alcoves/internal/db"
)

func GetRegister(c *fiber.Ctx) error {
	return c.Render("register", fiber.Map{
		"title":      "Register",
		"data_theme": "dark",
	})
}

func GetLogin(c *fiber.Ctx) error {
	return c.Render("login", fiber.Map{
		"title":      "Register",
		"data_theme": "dark",
	})
}

func PostRegister(c *fiber.Ctx) error {
	// For GET requests, just render the form
	if c.Method() == "GET" {
		return c.Render("register", fiber.Map{
			"Errors":   nil,
			"Username": "",
		})
	}

	// Process POST form submission
	username := c.FormValue("username")
	password := c.FormValue("password")

	// Validate the form data
	errors := make(map[string]string)

	// Example validation
	if len(username) < 3 {
		errors["Username"] = "Username must be at least 3 characters"
	}

	if len(password) < 8 {
		errors["Password"] = "Password must be at least 8 characters"
	}

	// If validation failed, re-render the form with errors
	if len(errors) > 0 {
		return c.Status(fiber.StatusBadRequest).Render("register", fiber.Map{
			"Errors":     errors,
			"Username":   username,
			"data_theme": "dark",
		})
	}

	// If no errors, handle successful registration
	// ... registration logic here ...

	// Redirect to success page or dashboard
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
