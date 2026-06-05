package files

import "gorm.io/gorm"

// DescendantFolderIDs returns all folder IDs beneath rootFolderID (exclusive)
// within the library, via breadth-first traversal of parent_folder_id.
func DescendantFolderIDs(db *gorm.DB, libraryID, rootFolderID string) []string {
	var descendants []string
	visited := map[string]bool{}
	queue := []string{rootFolderID}

	for len(queue) > 0 {
		currentID := queue[0]
		queue = queue[1:]
		if visited[currentID] {
			continue
		}
		visited[currentID] = true

		var children []struct {
			ID string `gorm:"column:id"`
		}
		db.Raw(
			"SELECT id FROM folders WHERE library_id = ? AND parent_folder_id = ?",
			libraryID, currentID,
		).Scan(&children)

		for _, child := range children {
			descendants = append(descendants, child.ID)
			queue = append(queue, child.ID)
		}
	}

	return descendants
}
