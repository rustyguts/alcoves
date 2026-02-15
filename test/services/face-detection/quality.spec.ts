import {
  computeFaceQuality,
  computeSizeScore,
  computeLandmarkScore,
  computeAspectScore,
} from "~~/server/services/face-detection/quality";
import type { DetectedFace } from "~~/server/services/face-detection/detect";

function makeFace(overrides: Partial<DetectedFace> = {}): DetectedFace {
  return {
    box: { x: 100, y: 100, width: 200, height: 200 },
    landmarks: [
      [150, 150], // left eye
      [250, 150], // right eye
      [200, 200], // nose
      [160, 240], // left mouth
      [240, 240], // right mouth
    ],
    confidence: 0.95,
    ...overrides,
  };
}

describe("computeSizeScore", () => {
  it("returns 0 for zero image area", () => {
    expect(computeSizeScore({ x: 0, y: 0, width: 100, height: 100 }, 0, 0)).toBe(0);
  });

  it("returns low score for tiny face relative to image", () => {
    // 10x10 face in 1000x1000 image = 0.01% area
    const score = computeSizeScore({ x: 0, y: 0, width: 10, height: 10 }, 1000, 1000);
    expect(score).toBeLessThan(0.2);
  });

  it("returns high score for face covering significant area", () => {
    // 300x300 face in 1000x1000 image = 9% area
    const score = computeSizeScore({ x: 0, y: 0, width: 300, height: 300 }, 1000, 1000);
    expect(score).toBeGreaterThan(0.8);
  });

  it("returns near-1 for very large face", () => {
    // 500x500 face in 800x800 image = ~39% area
    const score = computeSizeScore({ x: 0, y: 0, width: 500, height: 500 }, 800, 800);
    expect(score).toBeGreaterThan(0.95);
  });
});

describe("computeLandmarkScore", () => {
  it("returns high score for well-aligned frontal face", () => {
    const face = makeFace();
    const score = computeLandmarkScore(face.landmarks, face.box);
    expect(score).toBeGreaterThan(0.8);
  });

  it("returns lower score when eyes are not level", () => {
    const tilted = makeFace({
      landmarks: [
        [150, 130], // left eye higher
        [250, 180], // right eye lower
        [200, 200],
        [160, 240],
        [240, 240],
      ],
    });
    const normal = makeFace();
    const tiltedScore = computeLandmarkScore(tilted.landmarks, tilted.box);
    const normalScore = computeLandmarkScore(normal.landmarks, normal.box);
    expect(tiltedScore).toBeLessThan(normalScore);
  });

  it("returns lower score when nose is off-center", () => {
    const offCenter = makeFace({
      landmarks: [
        [150, 150],
        [250, 150],
        [130, 200], // nose shifted left
        [160, 240],
        [240, 240],
      ],
    });
    const normal = makeFace();
    const offScore = computeLandmarkScore(offCenter.landmarks, offCenter.box);
    const normalScore = computeLandmarkScore(normal.landmarks, normal.box);
    expect(offScore).toBeLessThan(normalScore);
  });

  it("returns 0.5 for fewer than 5 landmarks", () => {
    const score = computeLandmarkScore([[100, 100]], { x: 0, y: 0, width: 200, height: 200 });
    expect(score).toBe(0.5);
  });

  it("returns 0.5 for zero face size", () => {
    const score = computeLandmarkScore(
      [
        [0, 0],
        [1, 0],
        [0.5, 0.5],
        [0, 1],
        [1, 1],
      ],
      { x: 0, y: 0, width: 0, height: 0 },
    );
    expect(score).toBe(0.5);
  });
});

describe("computeAspectScore", () => {
  it("returns 1.0 for perfect square", () => {
    expect(computeAspectScore({ x: 0, y: 0, width: 100, height: 100 })).toBe(1);
  });

  it("returns high score for near-square", () => {
    const score = computeAspectScore({ x: 0, y: 0, width: 110, height: 100 });
    expect(score).toBeGreaterThan(0.8);
  });

  it("returns low score for very elongated box", () => {
    const score = computeAspectScore({ x: 0, y: 0, width: 50, height: 200 });
    expect(score).toBeLessThan(0.1);
  });

  it("returns 0 for zero dimensions", () => {
    expect(computeAspectScore({ x: 0, y: 0, width: 0, height: 100 })).toBe(0);
    expect(computeAspectScore({ x: 0, y: 0, width: 100, height: 0 })).toBe(0);
  });
});

describe("computeFaceQuality", () => {
  it("returns score between 0 and 1", () => {
    const face = makeFace();
    const score = computeFaceQuality(face, 1000, 1000);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns higher score for large frontal face", () => {
    const largeFace = makeFace({
      box: { x: 100, y: 100, width: 400, height: 400 },
      confidence: 0.99,
    });
    const smallFace = makeFace({
      box: { x: 100, y: 100, width: 30, height: 30 },
      confidence: 0.55,
    });
    const largeScore = computeFaceQuality(largeFace, 1000, 1000);
    const smallScore = computeFaceQuality(smallFace, 1000, 1000);
    expect(largeScore).toBeGreaterThan(smallScore);
  });

  it("returns lower score for low confidence", () => {
    const highConf = makeFace({ confidence: 0.99 });
    const lowConf = makeFace({ confidence: 0.55 });
    const highScore = computeFaceQuality(highConf, 1000, 1000);
    const lowScore = computeFaceQuality(lowConf, 1000, 1000);
    expect(highScore).toBeGreaterThan(lowScore);
  });
});
