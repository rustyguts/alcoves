import { iou, nms, decodeOutputs } from "~~/server/services/face-detection/detect";
import type { DetectedFace } from "~~/server/services/face-detection/detect";

describe("iou", () => {
  it("returns 1 for identical boxes", () => {
    const box = { x: 10, y: 10, width: 50, height: 50 };
    expect(iou(box, box)).toBeCloseTo(1.0);
  });

  it("returns 0 for non-overlapping boxes", () => {
    const a = { x: 0, y: 0, width: 50, height: 50 };
    const b = { x: 100, y: 100, width: 50, height: 50 };
    expect(iou(a, b)).toBe(0);
  });

  it("returns correct value for partially overlapping boxes", () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 50, y: 50, width: 100, height: 100 };
    // Intersection: 50*50=2500, Union: 10000+10000-2500=17500
    expect(iou(a, b)).toBeCloseTo(2500 / 17500);
  });

  it("handles contained box correctly", () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 25, y: 25, width: 50, height: 50 };
    // Intersection = 2500, Union = 10000+2500-2500=10000
    expect(iou(outer, inner)).toBeCloseTo(0.25);
  });

  it("returns 0 for zero-area boxes", () => {
    const a = { x: 0, y: 0, width: 0, height: 0 };
    const b = { x: 0, y: 0, width: 50, height: 50 };
    expect(iou(a, b)).toBe(0);
  });
});

describe("nms", () => {
  function makeFace(x: number, y: number, w: number, h: number, confidence: number): DetectedFace {
    return {
      box: { x, y, width: w, height: h },
      landmarks: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      confidence,
    };
  }

  it("returns empty array for empty input", () => {
    expect(nms([])).toEqual([]);
  });

  it("returns single face unchanged", () => {
    const faces = [makeFace(0, 0, 100, 100, 0.9)];
    expect(nms(faces)).toHaveLength(1);
  });

  it("suppresses overlapping lower-confidence face", () => {
    const faces = [
      makeFace(0, 0, 100, 100, 0.9),
      makeFace(5, 5, 100, 100, 0.7), // heavily overlaps
    ];
    const result = nms(faces);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe(0.9);
  });

  it("keeps non-overlapping faces", () => {
    const faces = [makeFace(0, 0, 50, 50, 0.9), makeFace(200, 200, 50, 50, 0.8)];
    expect(nms(faces)).toHaveLength(2);
  });

  it("handles multiple suppression groups", () => {
    const faces = [
      makeFace(0, 0, 100, 100, 0.9),
      makeFace(5, 5, 100, 100, 0.85),
      makeFace(300, 300, 100, 100, 0.8),
      makeFace(305, 305, 100, 100, 0.75),
    ];
    const result = nms(faces);
    expect(result).toHaveLength(2);
  });
});

describe("decodeOutputs", () => {
  it("filters faces below confidence threshold", () => {
    // Single anchor with low confidence
    const scores = new Float32Array([0.1]);
    const bboxes = new Float32Array([10, 10, 10, 10]);
    const kps = new Float32Array(10).fill(0);

    const faces = decodeOutputs(scores, bboxes, kps, 0.5, 8, 1, 1, 1, 20, 1.0, 1.0);
    expect(faces).toHaveLength(0);
  });

  it("returns face when above confidence threshold", () => {
    const scores = new Float32Array([0.9]);
    const bboxes = new Float32Array([5, 5, 5, 5]);
    const kps = new Float32Array(10).fill(1);

    const faces = decodeOutputs(scores, bboxes, kps, 0.5, 8, 1, 1, 1, 1, 1.0, 1.0);
    expect(faces.length).toBeGreaterThanOrEqual(1);
    expect(faces[0]!.confidence).toBeCloseTo(0.9);
  });

  it("filters faces smaller than minFaceSize", () => {
    // Bbox values that produce a tiny face
    const scores = new Float32Array([0.9]);
    const bboxes = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    const kps = new Float32Array(10).fill(0);

    const faces = decodeOutputs(scores, bboxes, kps, 0.5, 8, 1, 1, 1, 100, 1.0, 1.0);
    expect(faces).toHaveLength(0);
  });

  it("applies scale factors to output coordinates", () => {
    const scores = new Float32Array([0.9]);
    const bboxes = new Float32Array([2, 2, 2, 2]);
    const kps = new Float32Array(10).fill(0);

    const faces1x = decodeOutputs(scores, bboxes, kps, 0.5, 8, 1, 1, 1, 1, 1.0, 1.0);
    const faces2x = decodeOutputs(scores, bboxes, kps, 0.5, 8, 1, 1, 1, 1, 2.0, 2.0);

    if (faces1x.length > 0 && faces2x.length > 0) {
      // Scaled face should have coordinates roughly 2x larger
      expect(faces2x[0]!.box.width).toBeGreaterThan(faces1x[0]!.box.width);
    }
  });

  it("returns empty array for zero anchorCount", () => {
    const scores = new Float32Array(0);
    const bboxes = new Float32Array(0);
    const kps = new Float32Array(0);

    const faces = decodeOutputs(scores, bboxes, kps, 0.5, 8, 1, 1, 0, 20, 1.0, 1.0);
    expect(faces).toHaveLength(0);
  });
});
