package seed

import (
	"time"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

// seedFamily fills the "Family Photos" library: nested folders, photos + a
// video with EXIF/GPS metadata (Timeline + Map), tags, named + unknown people
// with face crops, object detections, and an activity feed.
func (s *seeder) seedFamily(lib *models.Library, admin, alice, bob *models.User) {
	if s.err != nil {
		return
	}
	day := 24 * time.Hour
	iphone, iphoneModel := sp("Apple"), sp("iPhone 15 Pro")
	canon, canonModel := sp("Canon"), sp("Canon EOS R6")

	// Tags
	tFav := s.createTag("tag/family/fav", lib.ID, "favorite", "#ef4444", s.ago(115*day))
	tFamily := s.createTag("tag/family/family", lib.ID, "family", "#3b82f6", s.ago(115*day))
	tBeach := s.createTag("tag/family/beach", lib.ID, "beach", "#06b6d4", s.ago(110*day))
	tPets := s.createTag("tag/family/pets", lib.ID, "pets", "#f59e0b", s.ago(105*day))

	// Folders (Vacations > Beach 2025; Birthdays)
	vacations := s.createFolder("folder/family/vacations", lib.ID, nil, "Vacations", admin.ID, s.ago(110*day))
	beach := s.createFolder("folder/family/beach2025", lib.ID, up(vacations.ID), "Beach 2025", admin.ID, s.ago(100*day))
	birthdays := s.createFolder("folder/family/birthdays", lib.ID, nil, "Birthdays", admin.ID, s.ago(95*day))
	s.tagFolder(vacations.ID, tFav.ID)
	s.tagFolder(beach.ID, tBeach.ID)

	// Files — photos with capture time + GPS so Timeline/Map have content.
	// Capture dates are deliberately spread across ~2 years (three calendar
	// years) so the timeline's date scrubber has multiple year/month buckets to
	// render in local dev. "Beach 2025" / "Vacations" photos stay in 2025 to
	// match their folder names.
	beachF := s.addFile(fileSpec{
		idName: "file/family/beach", lib: lib.ID, parent: up(beach.ID), owner: admin.ID,
		name: "beach-sunset.jpg", assetRel: "images/beach-sunset.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(330 * day)), gpsLat: fp(34.0089), gpsLon: fp(-118.4973),
		cameraMake: iphone, camera: iphoneModel, createdAt: s.ago(330 * day),
	})
	lakeF := s.addFile(fileSpec{
		idName: "file/family/lake", lib: lib.ID, parent: up(beach.ID), owner: admin.ID,
		name: "mountain-lake.jpg", assetRel: "images/mountain-lake.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(325 * day)), gpsLat: fp(39.0968), gpsLon: fp(-120.0324),
		cameraMake: iphone, camera: iphoneModel, createdAt: s.ago(325 * day),
	})
	desertF := s.addFile(fileSpec{
		idName: "file/family/desert", lib: lib.ID, parent: up(vacations.ID), owner: alice.ID,
		name: "desert-dunes.jpg", assetRel: "images/desert-dunes.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(300 * day)), gpsLat: fp(33.8734), gpsLon: fp(-115.9010),
		cameraMake: canon, camera: canonModel, createdAt: s.ago(300 * day),
	})
	vacVideo := s.addFile(fileSpec{
		idName: "file/family/vacation-video", lib: lib.ID, parent: up(vacations.ID), owner: admin.ID,
		name: "vacation-recap.mp4", assetRel: "videos/vacation-recap.mp4", mime: "video/mp4",
		width: 1280, height: 720, duration: 5, thumbAsset: "thumbs/vacation-recap.webp",
		capturedAt: tp(s.ago(298 * day)), gpsLat: fp(33.8740), gpsLon: fp(-115.9020),
		createdAt: s.ago(298 * day),
	})
	familyPortrait := s.addFile(fileSpec{
		idName: "file/family/portrait", lib: lib.ID, parent: up(birthdays.ID), owner: admin.ID,
		name: "family-portrait.jpg", assetRel: "images/family-portrait.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(420 * day)), cameraMake: canon, camera: canonModel, createdAt: s.ago(420 * day),
	})
	birthdayParty := s.addFile(fileSpec{
		idName: "file/family/birthday", lib: lib.ID, parent: up(birthdays.ID), owner: alice.ID,
		name: "birthday-party.jpg", assetRel: "images/birthday-party.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(560 * day)), cameraMake: iphone, camera: iphoneModel, createdAt: s.ago(560 * day),
	})
	// Root-level photos
	cityF := s.addFile(fileSpec{
		idName: "file/family/city", lib: lib.ID, owner: admin.ID,
		name: "city-skyline.jpg", assetRel: "images/city-skyline.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(40 * day)), gpsLat: fp(37.7749), gpsLon: fp(-122.4194),
		cameraMake: iphone, camera: iphoneModel, createdAt: s.ago(40 * day),
	})
	dogF := s.addFile(fileSpec{
		idName: "file/family/dog", lib: lib.ID, owner: admin.ID,
		name: "golden-retriever.jpg", assetRel: "images/golden-retriever.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(120 * day)), gpsLat: fp(37.7690), gpsLon: fp(-122.4830),
		cameraMake: iphone, camera: iphoneModel, createdAt: s.ago(120 * day),
	})
	cafeF := s.addFile(fileSpec{
		idName: "file/family/cafe", lib: lib.ID, owner: bob.ID,
		name: "street-cafe.jpg", assetRel: "images/street-cafe.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(200 * day)), gpsLat: fp(37.7600), gpsLon: fp(-122.4350),
		cameraMake: canon, camera: canonModel, createdAt: s.ago(200 * day),
	})
	bikeF := s.addFile(fileSpec{
		idName: "file/family/bike", lib: lib.ID, owner: admin.ID,
		name: "mountain-bike.jpg", assetRel: "images/mountain-bike.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(620 * day)), gpsLat: fp(39.1900), gpsLon: fp(-106.8175),
		cameraMake: iphone, camera: iphoneModel, createdAt: s.ago(620 * day),
	})
	forestF := s.addFile(fileSpec{
		idName: "file/family/forest", lib: lib.ID, owner: admin.ID,
		name: "forest-trail.jpg", assetRel: "images/forest-trail.jpg", mime: "image/jpeg",
		capturedAt: tp(s.ago(720 * day)), gpsLat: fp(37.8970), gpsLon: fp(-122.5811),
		cameraMake: iphone, camera: iphoneModel, createdAt: s.ago(720 * day),
	})

	// Tags on files
	s.tagFile(beachF.ID, tBeach.ID)
	s.tagFile(beachF.ID, tFav.ID)
	s.tagFile(lakeF.ID, tBeach.ID)
	s.tagFile(familyPortrait.ID, tFamily.ID)
	s.tagFile(familyPortrait.ID, tFav.ID)
	s.tagFile(birthdayParty.ID, tFamily.ID)
	s.tagFile(dogF.ID, tPets.ID)
	s.tagFile(dogF.ID, tFav.ID)
	s.tagFile(forestF.ID, tFav.ID)
	s.tagFile(desertF.ID, tFav.ID)

	// People + faces (recognition enabled). Boxes are within the 1024x768 photos.
	personAlice := s.createPerson("person/family/alice", lib.ID, sp("Alice"), s.ago(88*day))
	personBob := s.createPerson("person/family/bob", lib.ID, sp("Bob"), s.ago(87*day))
	personUnknown := s.createPerson("person/family/unknown", lib.ID, nil, s.ago(58*day))

	faceA1 := s.addFace("face/family/alice1", familyPortrait, lib.ID, up(personAlice.ID), [4]int{280, 170, 160, 160}, 97, "faces/alice.webp")
	faceB1 := s.addFace("face/family/bob1", familyPortrait, lib.ID, up(personBob.ID), [4]int{560, 180, 160, 160}, 95, "faces/bob.webp")
	s.addFace("face/family/alice2", birthdayParty, lib.ID, up(personAlice.ID), [4]int{220, 150, 150, 150}, 92, "faces/alice.webp")
	faceU1 := s.addFace("face/family/unknown1", birthdayParty, lib.ID, up(personUnknown.ID), [4]int{620, 190, 140, 140}, 88, "faces/unknown.webp")

	s.setPersonCover(personAlice.ID, faceA1.ID, 2)
	s.setPersonCover(personBob.ID, faceB1.ID, 1)
	s.setPersonCover(personUnknown.ID, faceU1.ID, 1)

	// Object detections (detection enabled).
	s.addObject("obj/family/dog1", dogF, lib.ID, "dog", 94, [4]int{210, 160, 520, 470})
	s.addObject("obj/family/dog2", dogF, lib.ID, "frisbee", 62, [4]int{120, 110, 120, 90})
	s.addObject("obj/family/cafe1", cafeF, lib.ID, "person", 88, [4]int{120, 90, 240, 540})
	s.addObject("obj/family/cafe2", cafeF, lib.ID, "chair", 76, [4]int{420, 360, 200, 260})
	s.addObject("obj/family/cafe3", cafeF, lib.ID, "cup", 71, [4]int{500, 300, 80, 70})
	s.addObject("obj/family/cafe4", cafeF, lib.ID, "dining table", 68, [4]int{360, 380, 420, 260})
	s.addObject("obj/family/bike1", bikeF, lib.ID, "bicycle", 91, [4]int{180, 220, 560, 360})
	s.addObject("obj/family/bike2", bikeF, lib.ID, "person", 85, [4]int{300, 90, 220, 460})
	s.addObject("obj/family/city1", cityF, lib.ID, "car", 80, [4]int{120, 520, 220, 120})
	s.addObject("obj/family/city2", cityF, lib.ID, "traffic light", 66, [4]int{700, 300, 60, 150})

	// Activity feed
	s.addActivity("act/family/member-alice", lib.ID, up(admin.ID), activity.ActionMemberJoined, activity.SubjectMember, up(alice.ID),
		map[string]any{"userId": alice.ID.String(), "displayName": alice.DisplayName}, s.ago(118*day))
	s.addActivity("act/family/member-bob", lib.ID, up(admin.ID), activity.ActionMemberJoined, activity.SubjectMember, up(bob.ID),
		map[string]any{"userId": bob.ID.String(), "displayName": bob.DisplayName}, s.ago(100*day))
	s.addActivity("act/family/folder-vac", lib.ID, up(admin.ID), activity.ActionFolderCreated, activity.SubjectFolder, up(vacations.ID),
		map[string]any{"name": vacations.Name}, s.ago(110*day))
	s.addActivity("act/family/tag-beach", lib.ID, up(admin.ID), activity.ActionTagCreated, activity.SubjectTag, up(tBeach.ID),
		map[string]any{"name": tBeach.Name, "color": tBeach.Color}, s.ago(110*day))
	s.addFileActivity("act/family/file-beach", lib.ID, alice.ID, beachF, s.ago(108*day))
	s.addFileActivity("act/family/file-portrait", lib.ID, admin.ID, familyPortrait, s.ago(90*day))
	s.addFileActivity("act/family/file-dog", lib.ID, admin.ID, dogF, s.ago(45*day))
	s.addFileActivity("act/family/file-forest", lib.ID, admin.ID, forestF, s.ago(20*day))
	s.addFileActivity("act/family/file-vacation", lib.ID, admin.ID, vacVideo, s.ago(69*day))
}

// addFileActivity is a convenience for the common "file uploaded" feed entry.
func (s *seeder) addFileActivity(idName string, lib, actor uuid.UUID, file *models.File, at time.Time) {
	var parent any
	if file.ParentFolderID != nil {
		parent = file.ParentFolderID.String()
	}
	s.addActivity(idName, lib, up(actor), activity.ActionFileCreated, activity.SubjectFile, up(file.ID),
		map[string]any{
			"name":           file.Name,
			"mimeType":       file.MimeType,
			"size":           file.Size,
			"parentFolderId": parent,
		}, at)
}
