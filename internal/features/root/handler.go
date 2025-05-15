package root

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rustyguts/alcoves/internal/features/assets"
)

func GetRoot(c *gin.Context) {
	user, _ := c.Get("user")
	c.HTML(http.StatusOK, "index.html", gin.H{
		"title":  "Alcoves",
		"User":   user,
		"Assets": assets.GetUserAssets(c),
	})
}
