package facedetection

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// FaceAssignmentResult describes the result of assigning a face to a person.
type FaceAssignmentResult struct {
	PersonID uuid.UUID
	IsNew    bool    // True if a new person was created
	Distance float64 // Best match distance (0 if new)
}

// AssignFaceUsingCorePoint assigns a face detection to an existing or new person
// using core-point clustering with pgvector cosine distance.
func AssignFaceUsingCorePoint(db *gorm.DB, config *FaceConfig, libraryID string, faceDetectionID uuid.UUID, embedding []float32) (*FaceAssignmentResult, error) {
	embStr := embeddingToString(embedding)

	// Find the closest existing face detection in this library using cosine distance
	type neighborRow struct {
		PersonID *string `gorm:"column:person_id"`
		Distance float64 `gorm:"column:distance"`
	}

	var neighbors []neighborRow
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL hnsw.ef_search = 40").Error; err != nil {
			return fmt.Errorf("set hnsw.ef_search: %w", err)
		}
		return tx.Raw(`
			SELECT fd.person_id, (fd.embedding <=> $1::vector) AS distance
			FROM face_detections fd
			WHERE fd.library_id = $2
			  AND fd.id != $3
			  AND fd.person_id IS NOT NULL
			ORDER BY fd.embedding <=> $1::vector
			LIMIT $4
		`, embStr, libraryID, faceDetectionID, config.NeighborLookup).Scan(&neighbors).Error
	})
	if err != nil {
		return nil, fmt.Errorf("neighbor query failed: %w", err)
	}

	// Find the best matching person (lowest distance below threshold)
	var bestPersonID *string
	var bestDistance float64 = 999

	// Count votes per person within match candidate distance
	personVotes := make(map[string]int)
	personBestDist := make(map[string]float64)

	for _, n := range neighbors {
		if n.PersonID == nil || n.Distance > config.MatchCandidateDistance {
			continue
		}
		pid := *n.PersonID
		personVotes[pid]++
		if d, ok := personBestDist[pid]; !ok || n.Distance < d {
			personBestDist[pid] = n.Distance
		}
	}

	// Pick the person with the most votes within max distance
	for pid, votes := range personVotes {
		dist := personBestDist[pid]
		if dist <= config.MaxDistance && votes >= 1 {
			if dist < bestDistance {
				bestDistance = dist
				bestPersonID = &pid
			}
		}
	}

	if bestPersonID != nil {
		// Assign to existing person
		personUUID, _ := uuid.Parse(*bestPersonID)

		// Update the face detection's person_id
		db.Exec("UPDATE face_detections SET person_id = ? WHERE id = ?", personUUID, faceDetectionID)

		// Increment person face count
		db.Exec("UPDATE people SET face_count = face_count + 1, updated_at = NOW() WHERE id = ?", personUUID)

		return &FaceAssignmentResult{
			PersonID: personUUID,
			IsNew:    false,
			Distance: bestDistance,
		}, nil
	}

	// No good match — check if we have enough unassigned faces nearby to form a new cluster
	// Count unassigned faces that are close to this embedding
	var nearbyUnassigned int64
	_ = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL hnsw.ef_search = 40").Error; err != nil {
			return fmt.Errorf("set hnsw.ef_search: %w", err)
		}
		return tx.Raw(`
			SELECT COUNT(*)
			FROM face_detections fd
			WHERE fd.library_id = $1
			  AND fd.person_id IS NULL
			  AND fd.id != $2
			  AND (fd.embedding <=> $3::vector) < $4
		`, libraryID, faceDetectionID, embStr, config.MaxDistance).Scan(&nearbyUnassigned).Error
	})

	if int(nearbyUnassigned)+1 >= config.MinFaces {
		// Create a new person and assign this face + nearby unassigned faces
		newPerson := uuid.New()
		db.Exec(`
			INSERT INTO people (id, library_id, face_count, created_at, updated_at)
			VALUES (?, ?, 0, NOW(), NOW())
		`, newPerson, libraryID)

		// Assign this face
		db.Exec("UPDATE face_detections SET person_id = ? WHERE id = ?", newPerson, faceDetectionID)

		// Assign nearby unassigned faces
		result := db.Exec(`
			UPDATE face_detections
			SET person_id = $1
			WHERE library_id = $2
			  AND person_id IS NULL
			  AND id != $3
			  AND (embedding <=> $4::vector) < $5
		`, newPerson, libraryID, faceDetectionID, embStr, config.MaxDistance)

		totalAssigned := int(result.RowsAffected) + 1

		// Update face count and set cover photo
		db.Exec("UPDATE people SET face_count = ?, cover_face_detection_id = ?, updated_at = NOW() WHERE id = ?",
			totalAssigned, faceDetectionID, newPerson)

		return &FaceAssignmentResult{
			PersonID: newPerson,
			IsNew:    true,
		}, nil
	}

	// Not enough evidence — leave unassigned for now
	return nil, nil
}

// ReconcileNewPerson checks if a newly created person should be auto-merged with an existing person.
// Returns the final person ID (may be different from sourcePersonID if merged).
func ReconcileNewPerson(db *gorm.DB, config *FaceConfig, libraryID string, sourcePersonID uuid.UUID) (uuid.UUID, error) {
	// Sample embeddings from the source person
	type embRow struct {
		Embedding string `gorm:"column:embedding"`
	}

	var samples []embRow
	db.Raw(`
		SELECT embedding::text as embedding
		FROM face_detections
		WHERE person_id = $1 AND embedding IS NOT NULL
		ORDER BY quality_score DESC NULLS LAST
		LIMIT 5
	`, sourcePersonID).Scan(&samples)

	if len(samples) == 0 {
		return sourcePersonID, nil
	}

	// For each sample, find the closest face in a *different* person
	type mergeCandidate struct {
		PersonID string
		Distance float64
	}

	candidateVotes := make(map[string]int)
	candidateBestDist := make(map[string]float64)

	for _, s := range samples {
		var candidates []mergeCandidate
		_ = db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Exec("SET LOCAL hnsw.ef_search = 40").Error; err != nil {
				return fmt.Errorf("set hnsw.ef_search: %w", err)
			}
			return tx.Raw(`
				SELECT fd.person_id, (fd.embedding <=> $1::vector) AS distance
				FROM face_detections fd
				WHERE fd.library_id = $2
				  AND fd.person_id IS NOT NULL
				  AND fd.person_id != $3
				ORDER BY fd.embedding <=> $1::vector
				LIMIT 10
			`, s.Embedding, libraryID, sourcePersonID).Scan(&candidates).Error
		})

		for _, c := range candidates {
			if c.Distance <= config.AutoMergeDistance {
				candidateVotes[c.PersonID]++
				if d, ok := candidateBestDist[c.PersonID]; !ok || c.Distance < d {
					candidateBestDist[c.PersonID] = c.Distance
				}
			}
		}
	}

	// Find the best merge target with enough evidence
	var mergeTarget *string
	bestEvidence := 0

	for pid, votes := range candidateVotes {
		if votes >= config.AutoMergeMinEvidence && votes > bestEvidence {
			bestEvidence = votes
			p := pid
			mergeTarget = &p
		}
	}

	if mergeTarget == nil {
		return sourcePersonID, nil
	}

	targetID, _ := uuid.Parse(*mergeTarget)

	// Merge: move all faces from source to target
	db.Exec("UPDATE face_detections SET person_id = ? WHERE person_id = ?", targetID, sourcePersonID)

	// Update target face count
	var totalFaces int64
	db.Raw("SELECT COUNT(*) FROM face_detections WHERE person_id = ?", targetID).Scan(&totalFaces)
	db.Exec("UPDATE people SET face_count = ?, updated_at = NOW() WHERE id = ?", totalFaces, targetID)

	// Delete source person
	db.Exec("DELETE FROM people WHERE id = ?", sourcePersonID)

	return targetID, nil
}

// embeddingToString converts a float32 embedding to a pgvector-compatible string.
func embeddingToString(embedding []float32) string {
	parts := make([]string, len(embedding))
	for i, v := range embedding {
		parts[i] = fmt.Sprintf("%f", v)
	}
	return "[" + strings.Join(parts, ",") + "]"
}
