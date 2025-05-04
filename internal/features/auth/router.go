package auth

import (
	"github.com/gofiber/fiber/v2"
)

func Router(app fiber.Router) {
	app.Post("/login", PostLogin)
}

// app.Get("/logout", func(c *fiber.Ctx) error {
// 	sess, err := store.Get(c)
// 	if err != nil {
// 		return c.Status(fiber.StatusInternalServerError).SendString("Failed to get session")
// 	}
// 	// Delete key
// 	sess.Delete("name")

// 	// Destroy session
// 	if err := sess.Destroy(); err != nil {
// 		panic(err)
// 	}
// 	return c.SendString("Logged out")
// })

// app.Get("/session", func(c *fiber.Ctx) error {
// 	// Get session from storage
// 	sess, err := store.Get(c)
// 	if err != nil {
// 		panic(err)
// 	}

// 	// Get value
// 	name := sess.Get("name")

// 	// Set key/value
// 	sess.Set("name", "john")

// 	// Get all Keys
// 	keys := sess.Keys()
// 	fmt.Println(keys)

// 	// Delete key
// 	sess.Delete("name")

// 	// Destroy session
// 	if err := sess.Destroy(); err != nil {
// 		panic(err)
// 	}

// 	// Sets a specific expiration for this session
// 	sess.SetExpiry(time.Second * 2)

// 	// Save session
// 	if err := sess.Save(); err != nil {
// 		panic(err)
// 	}

// 	return c.SendString(fmt.Sprintf("Welcome %v", name))
// })
