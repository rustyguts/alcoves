package facedetection

import "math"

// ComputeFaceQuality scores a detected face from 0.0 to 1.0 based on:
// - Size score (30%): sigmoid of faceArea / imageArea
// - Confidence score (30%): direct detection confidence
// - Landmark score (25%): eye levelness, nose centering, mouth symmetry
// - Aspect score (15%): penalize non-square bounding boxes
func ComputeFaceQuality(face DetectedFace, imgW, imgH int) float64 {
	sizeScore := computeSizeScore(face.Box, imgW, imgH)
	confidenceScore := face.Confidence
	landmarkScore := computeLandmarkScore(face)
	aspectScore := computeAspectScore(face.Box)

	return 0.30*sizeScore + 0.30*confidenceScore + 0.25*landmarkScore + 0.15*aspectScore
}

// computeSizeScore uses a sigmoid to map faceArea/imageArea to 0..1.
// Larger faces in the image score higher.
func computeSizeScore(box BoundingBox, imgW, imgH int) float64 {
	imageArea := float64(imgW) * float64(imgH)
	if imageArea == 0 {
		return 0
	}
	faceArea := box.Width * box.Height
	ratio := faceArea / imageArea

	// Sigmoid centered around 2% of image area, with moderate steepness
	return sigmoid((ratio - 0.02) * 200)
}

// computeLandmarkScore evaluates geometric quality from landmark positions:
// - Eye levelness: how horizontal the eye line is
// - Nose centering: nose tip centered between eyes
// - Mouth symmetry: mouth corners level and centered
func computeLandmarkScore(face DetectedFace) float64 {
	lm := face.Landmarks

	// Eye levelness: angle between eye line and horizontal
	leftEye := lm[0]
	rightEye := lm[1]
	eyeDist := math.Sqrt(sqDist(leftEye, rightEye))
	if eyeDist < 1 {
		return 0.5 // Can't compute meaningful score
	}

	eyeAngle := math.Abs(math.Atan2(rightEye[1]-leftEye[1], rightEye[0]-leftEye[0]))
	eyeLevelScore := math.Max(0, 1.0-eyeAngle*5) // Penalize rotation

	// Nose centering: nose should be roughly between eyes horizontally
	nose := lm[2]
	eyeMidX := (leftEye[0] + rightEye[0]) / 2
	noseOffsetX := math.Abs(nose[0]-eyeMidX) / eyeDist
	noseCenterScore := math.Max(0, 1.0-noseOffsetX*3)

	// Mouth symmetry: mouth corners should be level
	leftMouth := lm[3]
	rightMouth := lm[4]
	mouthDist := math.Sqrt(sqDist(leftMouth, rightMouth))
	if mouthDist < 1 {
		return (eyeLevelScore + noseCenterScore) / 2
	}
	mouthAngle := math.Abs(math.Atan2(rightMouth[1]-leftMouth[1], rightMouth[0]-leftMouth[0]))
	mouthSymScore := math.Max(0, 1.0-mouthAngle*5)

	return (eyeLevelScore + noseCenterScore + mouthSymScore) / 3
}

// computeAspectScore penalizes bounding boxes that deviate from square.
func computeAspectScore(box BoundingBox) float64 {
	if box.Width == 0 || box.Height == 0 {
		return 0
	}
	ratio := box.Width / box.Height
	if ratio > 1 {
		ratio = 1 / ratio
	}
	// ratio is now in (0, 1], with 1 being perfectly square
	return ratio
}

func sigmoid(x float64) float64 {
	return 1.0 / (1.0 + math.Exp(-x))
}

func sqDist(a, b [2]float64) float64 {
	dx := a[0] - b[0]
	dy := a[1] - b[1]
	return dx*dx + dy*dy
}
