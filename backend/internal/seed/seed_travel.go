package seed

import (
	"time"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

// seedTravel fills "Travel 2025": photos spread across the globe (so the Map
// view has pins on multiple continents), object detections, and tags. Face
// recognition is off here; object detection + sharing are on.
func (s *seeder) seedTravel(lib *models.Library, admin, alice *models.User) {
	if s.err != nil {
		return
	}
	day := 24 * time.Hour
	cam, camModel := sp("Sony"), sp("Sony A7 IV")

	tFav := s.createTag("tag/travel/fav", lib.ID, "favorite", "#ef4444", s.ago(80*day))
	tLandscape := s.createTag("tag/travel/landscape", lib.ID, "landscape", "#22c55e", s.ago(80*day))
	tCities := s.createTag("tag/travel/cities", lib.ID, "cities", "#8b5cf6", s.ago(78*day))

	banff := s.addFile(fileSpec{
		idName: "file/travel/banff", lib: lib.ID, owner: admin.ID,
		name: "banff-lake.jpg", assetRel: "images/mountain-lake.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(76 * day)), gpsLat: fp(51.4254), gpsLon: fp(-116.1773),
		cameraMake: cam, camera: camModel, createdAt: s.ago(76 * day),
	})
	tokyo := s.addFile(fileSpec{
		idName: "file/travel/tokyo", lib: lib.ID, owner: admin.ID,
		name: "tokyo-skyline.jpg", assetRel: "images/city-skyline.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(64 * day)), gpsLat: fp(35.6762), gpsLon: fp(139.6503),
		cameraMake: cam, camera: camModel, createdAt: s.ago(64 * day),
	})
	sahara := s.addFile(fileSpec{
		idName: "file/travel/sahara", lib: lib.ID, owner: alice.ID,
		name: "sahara-dunes.jpg", assetRel: "images/desert-dunes.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(52 * day)), gpsLat: fp(31.0801), gpsLon: fp(-4.0000),
		cameraMake: cam, camera: camModel, createdAt: s.ago(52 * day),
	})
	blackForest := s.addFile(fileSpec{
		idName: "file/travel/blackforest", lib: lib.ID, owner: admin.ID,
		name: "black-forest-trail.jpg", assetRel: "images/forest-trail.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(40 * day)), gpsLat: fp(48.2730), gpsLon: fp(8.1830),
		cameraMake: cam, camera: camModel, createdAt: s.ago(40 * day),
	})
	alps := s.addFile(fileSpec{
		idName: "file/travel/alps", lib: lib.ID, owner: admin.ID,
		name: "swiss-alps-ride.jpg", assetRel: "images/mountain-bike.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(28 * day)), gpsLat: fp(46.5197), gpsLon: fp(7.5448),
		cameraMake: cam, camera: camModel, createdAt: s.ago(28 * day),
	})

	s.tagFile(banff.ID, tLandscape.ID)
	s.tagFile(banff.ID, tFav.ID)
	s.tagFile(tokyo.ID, tCities.ID)
	s.tagFile(sahara.ID, tLandscape.ID)
	s.tagFile(blackForest.ID, tLandscape.ID)
	s.tagFile(alps.ID, tFav.ID)

	// A few object detections so the Objects view isn't empty here either.
	s.addObject("obj/travel/tokyo1", tokyo, lib.ID, "car", 83, [4]int{140, 540, 240, 120})
	s.addObject("obj/travel/tokyo2", tokyo, lib.ID, "traffic light", 71, [4]int{680, 280, 60, 160})
	s.addObject("obj/travel/alps1", alps, lib.ID, "bicycle", 90, [4]int{200, 220, 540, 360})
	s.addObject("obj/travel/alps2", alps, lib.ID, "person", 86, [4]int{320, 100, 220, 460})

	s.addActivity("act/travel/member-alice", lib.ID, up(admin.ID), activity.ActionMemberJoined, activity.SubjectMember, up(alice.ID),
		map[string]any{"userId": alice.ID.String(), "displayName": alice.DisplayName}, s.ago(78*day))
	s.addActivity("act/travel/tag-cities", lib.ID, up(admin.ID), activity.ActionTagCreated, activity.SubjectTag, up(tCities.ID),
		map[string]any{"name": tCities.Name, "color": tCities.Color}, s.ago(78*day))
	s.addFileActivity("act/travel/file-banff", lib.ID, admin.ID, banff, s.ago(76*day))
	s.addFileActivity("act/travel/file-tokyo", lib.ID, admin.ID, tokyo, s.ago(64*day))
	s.addFileActivity("act/travel/file-sahara", lib.ID, alice.ID, sahara, s.ago(52*day))
}
