package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

type PeopleHandler struct {
	db         *gorm.DB
	storageSvc *storage.Service
	faceSvc    *facedetection.Service
}

func NewPeopleHandler(db *gorm.DB, storageSvc *storage.Service, faceSvc *facedetection.Service) *PeopleHandler {
	return &PeopleHandler{db: db, storageSvc: storageSvc, faceSvc: faceSvc}
}

func (h *PeopleHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:id/people", h.List)
	g.PATCH("/:id/people/:personId", h.Update)
	g.GET("/:id/people/:personId/faces", h.ListFaces)
	g.GET("/:id/people/:personId/thumbnail", h.Thumbnail)
	g.POST("/:id/people/:personId/faces/:faceId/split", h.SplitFace)
	g.POST("/:id/people/merge", h.Merge)
	g.POST("/:id/face-recognition/reprocess", h.Reprocess)
}

type personResponse struct {
	ID                   string  `json:"id"`
	LibraryID            string  `json:"libraryId"`
	Name                 *string `json:"name"`
	FaceCount            int     `json:"faceCount"`
	CoverFaceDetectionID *string `json:"coverFaceDetectionId"`
	CreatedAt            string  `json:"createdAt"`
	UpdatedAt            string  `json:"updatedAt"`
}

func (h *PeopleHandler) List(c echo.Context) error {
	libraryID := c.Param("id")

	var people []models.Person
	h.db.Where("library_id = ? AND face_count > 0", libraryID).
		Order("COALESCE(name, '') ASC, face_count DESC").
		Find(&people)

	result := make([]personResponse, len(people))
	for i, p := range people {
		result[i] = toPersonResponse(&p)
	}

	return c.JSON(http.StatusOK, result)
}

type updatePersonRequest struct {
	Name                 *string `json:"name"`
	CoverFaceDetectionID *string `json:"coverFaceDetectionId"`
}

func (h *PeopleHandler) Update(c echo.Context) error {
	libraryID := c.Param("id")
	personID := c.Param("personId")

	var req updatePersonRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.CoverFaceDetectionID != nil {
		if *req.CoverFaceDetectionID == "" {
			updates["cover_face_detection_id"] = nil
		} else {
			updates["cover_face_detection_id"] = *req.CoverFaceDetectionID
		}
	}

	if len(updates) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "No fields to update")
	}
	updates["updated_at"] = time.Now()

	result := h.db.Model(&models.Person{}).
		Where("id = ? AND library_id = ?", personID, libraryID).
		Updates(updates)

	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Person not found")
	}

	var person models.Person
	h.db.Where("id = ?", personID).First(&person)

	return c.JSON(http.StatusOK, toPersonResponse(&person))
}

type faceResponse struct {
	ID          string `json:"id"`
	FileID      string `json:"fileId"`
	FileName    string `json:"fileName"`
	BoxX        int    `json:"boxX"`
	BoxY        int    `json:"boxY"`
	BoxWidth    int    `json:"boxWidth"`
	BoxHeight   int    `json:"boxHeight"`
	ImageWidth  int    `json:"imageWidth"`
	ImageHeight int    `json:"imageHeight"`
	Confidence  int    `json:"confidence"`
	CreatedAt   string `json:"createdAt"`
}

func (h *PeopleHandler) ListFaces(c echo.Context) error {
	libraryID := c.Param("id")
	personID := c.Param("personId")

	type faceRow struct {
		ID          string    `gorm:"column:id"`
		FileID      string    `gorm:"column:file_id"`
		FileName    string    `gorm:"column:file_name"`
		BoxX        int       `gorm:"column:box_x"`
		BoxY        int       `gorm:"column:box_y"`
		BoxWidth    int       `gorm:"column:box_width"`
		BoxHeight   int       `gorm:"column:box_height"`
		ImageWidth  int       `gorm:"column:image_width"`
		ImageHeight int       `gorm:"column:image_height"`
		Confidence  int       `gorm:"column:confidence"`
		CreatedAt   time.Time `gorm:"column:created_at"`
	}

	var rows []faceRow
	h.db.Raw(`
		SELECT fd.id, fd.file_id, f.name as file_name,
		       fd.box_x, fd.box_y, fd.box_width, fd.box_height,
		       fd.image_width, fd.image_height, fd.confidence, fd.created_at
		FROM face_detections fd
		INNER JOIN files f ON f.id = fd.file_id
		WHERE fd.person_id = ? AND fd.library_id = ?
		ORDER BY fd.confidence DESC
	`, personID, libraryID).Scan(&rows)

	result := make([]faceResponse, len(rows))
	for i, r := range rows {
		result[i] = faceResponse{
			ID:          r.ID,
			FileID:      r.FileID,
			FileName:    r.FileName,
			BoxX:        r.BoxX,
			BoxY:        r.BoxY,
			BoxWidth:    r.BoxWidth,
			BoxHeight:   r.BoxHeight,
			ImageWidth:  r.ImageWidth,
			ImageHeight: r.ImageHeight,
			Confidence:  r.Confidence,
			CreatedAt:   r.CreatedAt.Format(time.RFC3339Nano),
		}
	}

	return c.JSON(http.StatusOK, result)
}

func (h *PeopleHandler) Thumbnail(c echo.Context) error {
	libraryID := c.Param("id")
	personID := c.Param("personId")

	var person models.Person
	if err := h.db.Where("id = ? AND library_id = ?", personID, libraryID).First(&person).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Person not found")
	}

	if person.CoverFaceDetectionID == nil {
		return echo.NewHTTPError(http.StatusNotFound, "No cover photo set")
	}

	// Get the face detection to find the file
	var face models.FaceDetection
	if err := h.db.Where("id = ?", *person.CoverFaceDetectionID).First(&face).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Face detection not found")
	}

	// Try to serve cached face crop
	cacheKey := fmt.Sprintf("%s/faces/%s.webp", libraryID, face.ID.String())
	exists, _ := h.storageSvc.CacheExists(cacheKey)
	if exists {
		data, err := h.storageSvc.ReadCacheBuffer(cacheKey)
		if err == nil {
			c.Response().Header().Set("Cache-Control", "private, max-age=86400")
			return c.Blob(http.StatusOK, "image/webp", data)
		}
	}

	return echo.NewHTTPError(http.StatusNotFound, "Thumbnail not available")
}

func (h *PeopleHandler) SplitFace(c echo.Context) error {
	libraryID := c.Param("id")
	personID := c.Param("personId")
	faceID := c.Param("faceId")

	// Verify face belongs to person
	var face models.FaceDetection
	if err := h.db.Where("id = ? AND person_id = ? AND library_id = ?", faceID, personID, libraryID).First(&face).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Face not found")
	}

	// Create a new person for this face
	newPerson := models.Person{
		LibraryID:            uuid.MustParse(libraryID),
		CoverFaceDetectionID: &face.ID,
		FaceCount:            1,
	}
	h.db.Create(&newPerson)

	// Move face to new person
	h.db.Model(&face).Update("person_id", newPerson.ID)

	// Update old person's face count
	h.db.Model(&models.Person{}).Where("id = ?", personID).
		Update("face_count", gorm.Expr("face_count - 1"))

	// If old person's cover was this face, clear it
	var oldPerson models.Person
	h.db.Where("id = ?", personID).First(&oldPerson)
	if oldPerson.CoverFaceDetectionID != nil && *oldPerson.CoverFaceDetectionID == face.ID {
		// Set to another face or nil
		var anotherFace models.FaceDetection
		if err := h.db.Where("person_id = ? AND id != ?", personID, faceID).
			Order("confidence DESC").First(&anotherFace).Error; err == nil {
			h.db.Model(&oldPerson).Update("cover_face_detection_id", anotherFace.ID)
		} else {
			h.db.Model(&oldPerson).Update("cover_face_detection_id", nil)
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"newPersonId": newPerson.ID.String(),
	})
}

type mergeRequest struct {
	PersonIDs []string `json:"personIds" validate:"required,min=2"`
}

func (h *PeopleHandler) Merge(c echo.Context) error {
	libraryID := c.Param("id")

	var req mergeRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if len(req.PersonIDs) < 2 {
		return echo.NewHTTPError(http.StatusBadRequest, "At least 2 person IDs required")
	}

	// Use first person as the target
	targetID := req.PersonIDs[0]
	sourceIDs := req.PersonIDs[1:]

	// Verify all persons exist in this library
	var count int64
	h.db.Model(&models.Person{}).Where("id IN ? AND library_id = ?", req.PersonIDs, libraryID).Count(&count)
	if int(count) != len(req.PersonIDs) {
		return echo.NewHTTPError(http.StatusNotFound, "One or more persons not found")
	}

	// Move all faces from sources to target
	h.db.Model(&models.FaceDetection{}).
		Where("person_id IN ?", sourceIDs).
		Update("person_id", targetID)

	// Update target face count
	var totalFaces int64
	h.db.Model(&models.FaceDetection{}).Where("person_id = ?", targetID).Count(&totalFaces)
	h.db.Model(&models.Person{}).Where("id = ?", targetID).Update("face_count", totalFaces)

	// Preserve name from sources if target has none
	var target models.Person
	h.db.Where("id = ?", targetID).First(&target)
	if target.Name == nil {
		for _, sid := range sourceIDs {
			var source models.Person
			h.db.Where("id = ?", sid).First(&source)
			if source.Name != nil {
				h.db.Model(&target).Update("name", *source.Name)
				break
			}
		}
	}

	// Delete source persons
	h.db.Where("id IN ?", sourceIDs).Delete(&models.Person{})

	h.db.Where("id = ?", targetID).First(&target)
	return c.JSON(http.StatusOK, toPersonResponse(&target))
}

func (h *PeopleHandler) Reprocess(c echo.Context) error {
	libraryID := c.Param("id")

	if h.faceSvc == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Face recognition service not available")
	}

	enqueued, err := h.faceSvc.ReprocessLibrary(libraryID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, fmt.Sprintf("Reprocess failed: %v", err))
	}

	return c.JSON(http.StatusOK, map[string]int{"enqueued": enqueued})
}

func toPersonResponse(p *models.Person) personResponse {
	var coverID *string
	if p.CoverFaceDetectionID != nil {
		s := p.CoverFaceDetectionID.String()
		coverID = &s
	}
	return personResponse{
		ID:                   p.ID.String(),
		LibraryID:            p.LibraryID.String(),
		Name:                 p.Name,
		FaceCount:            p.FaceCount,
		CoverFaceDetectionID: coverID,
		CreatedAt:            p.CreatedAt.Format(time.RFC3339Nano),
		UpdatedAt:            p.UpdatedAt.Format(time.RFC3339Nano),
	}
}
