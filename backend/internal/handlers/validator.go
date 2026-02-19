package handlers

import (
	"net/http"
	"strings"

	"github.com/go-playground/validator/v10"
	"github.com/labstack/echo/v4"
)

// CustomValidator wraps go-playground/validator for Echo.
type CustomValidator struct {
	validator *validator.Validate
}

func NewValidator() *CustomValidator {
	return &CustomValidator{validator: validator.New()}
}

func (cv *CustomValidator) Validate(i interface{}) error {
	if err := cv.validator.Struct(i); err != nil {
		// Return first validation error as a readable message
		if validationErrors, ok := err.(validator.ValidationErrors); ok && len(validationErrors) > 0 {
			fe := validationErrors[0]
			msg := formatValidationError(fe)
			return echo.NewHTTPError(http.StatusBadRequest, msg)
		}
		return echo.NewHTTPError(http.StatusBadRequest, "Validation failed")
	}
	return nil
}

func formatValidationError(fe validator.FieldError) string {
	field := strings.ToLower(fe.Field())
	switch fe.Tag() {
	case "required":
		return field + " is required"
	case "email":
		return "Invalid email address"
	case "min":
		return field + " must be at least " + fe.Param() + " characters"
	default:
		return field + " is invalid"
	}
}
