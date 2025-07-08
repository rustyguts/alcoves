package root

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
)

func TestGetHealthcheck(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if assert.NoError(t, getHealthcheck(c)) {
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "OK", rec.Body.String())
	}
}

// func TestGetHealthcheckResponseHeaders(t *testing.T) {
// 	// Setup
// 	e := echo.New()
// 	req := httptest.NewRequest(http.MethodGet, "/health", nil)
// 	rec := httptest.NewRecorder()
// 	c := e.NewContext(req, rec)

// 	// Execute
// 	err := GetHealthcheck(c)

// 	// Assertions
// 	assert.NoError(t, err)
// 	assert.Equal(t, http.StatusOK, rec.Code)
// 	assert.Equal(t, "OK", rec.Body.String())
// 	assert.Equal(t, "text/plain; charset=UTF-8", rec.Header().Get("Content-Type"))
// 	assert.Equal(t, "2", rec.Header().Get("Content-Length"))
// }
