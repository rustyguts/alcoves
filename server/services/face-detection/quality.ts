import type { DetectedFace } from "./detect";

/**
 * Compute a quality score (0-1) for a detected face.
 *
 * Factors:
 * - Face size relative to image (larger = better embedding)
 * - Detection confidence from SCRFD
 * - Landmark alignment quality (eyes level, nose centered, mouth symmetric)
 * - Bounding box aspect ratio (close to 1:1 is ideal)
 */
export function computeFaceQuality(
  face: DetectedFace,
  imageWidth: number,
  imageHeight: number,
): number {
  const sizeScore = computeSizeScore(face.box, imageWidth, imageHeight);
  const confidenceScore = face.confidence;
  const landmarkScore = computeLandmarkScore(face.landmarks, face.box);
  const aspectScore = computeAspectScore(face.box);

  // Weighted combination — confidence and size matter most
  return sizeScore * 0.3 + confidenceScore * 0.3 + landmarkScore * 0.25 + aspectScore * 0.15;
}

/**
 * Score based on face size relative to image area.
 * Faces covering more of the image produce better embeddings.
 * Uses a sigmoid-like curve: tiny faces score low, medium faces score well.
 */
export function computeSizeScore(
  box: DetectedFace["box"],
  imageWidth: number,
  imageHeight: number,
): number {
  const imageArea = imageWidth * imageHeight;
  if (imageArea <= 0) return 0;

  const faceArea = box.width * box.height;
  const ratio = faceArea / imageArea;

  // Sigmoid mapping: 0.001 -> ~0.1, 0.01 -> ~0.5, 0.05 -> ~0.85, 0.15+ -> ~1.0
  // k controls steepness, midpoint is the ratio that maps to 0.5
  const k = 120;
  const midpoint = 0.015;
  return 1 / (1 + Math.exp(-k * (ratio - midpoint)));
}

/**
 * Score based on landmark alignment quality.
 * Checks:
 * - Eyes roughly level (small vertical difference)
 * - Nose horizontally centered between eyes
 * - Mouth corners roughly symmetric relative to nose
 */
export function computeLandmarkScore(landmarks: number[][], box: DetectedFace["box"]): number {
  if (landmarks.length < 5) return 0.5;

  const [leftEye, rightEye, nose, leftMouth, rightMouth] = landmarks as [
    number[],
    number[],
    number[],
    number[],
    number[],
  ];

  const faceSize = Math.max(box.width, box.height);
  if (faceSize <= 0) return 0.5;

  // Eye level score: how horizontal are the eyes?
  const eyeVerticalDiff = Math.abs(leftEye[1]! - rightEye[1]!) / faceSize;
  const eyeLevelScore = Math.max(0, 1 - eyeVerticalDiff * 5);

  // Nose centering: is nose horizontally between the eyes?
  const eyeMidX = (leftEye[0]! + rightEye[0]!) / 2;
  const noseOffsetX = Math.abs(nose[0]! - eyeMidX) / faceSize;
  const noseCenterScore = Math.max(0, 1 - noseOffsetX * 4);

  // Mouth symmetry: are mouth corners roughly equidistant from nose?
  const leftMouthDist = Math.abs(leftMouth[0]! - nose[0]!);
  const rightMouthDist = Math.abs(rightMouth[0]! - nose[0]!);
  const maxMouthDist = Math.max(leftMouthDist, rightMouthDist, 1);
  const mouthSymmetry = 1 - Math.abs(leftMouthDist - rightMouthDist) / maxMouthDist;

  return eyeLevelScore * 0.4 + noseCenterScore * 0.35 + mouthSymmetry * 0.25;
}

/**
 * Score based on bounding box aspect ratio.
 * Faces are roughly square; extreme aspect ratios indicate partial/occluded faces.
 */
export function computeAspectScore(box: DetectedFace["box"]): number {
  if (box.width <= 0 || box.height <= 0) return 0;
  const ratio = box.width / box.height;
  // Ideal ratio is 1.0. Penalize deviation.
  // ratio 0.7-1.3 -> high score, <0.5 or >2.0 -> low score
  const deviation = Math.abs(ratio - 1.0);
  return Math.max(0, 1 - deviation * 1.5);
}
