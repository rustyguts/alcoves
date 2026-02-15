import sharp from "sharp";
import * as ort from "onnxruntime-node";
import { loadDetectionSession } from "./models";
import { FACE_DETECTION_MIN_SCORE } from "./config";

export interface DetectedFace {
  box: { x: number; y: number; width: number; height: number };
  landmarks: number[][];
  confidence: number;
}

const PREFERRED_DYNAMIC_INPUT_SIZES = [640] as const;
const CONFIDENCE_THRESHOLD = FACE_DETECTION_MIN_SCORE;
const NMS_THRESHOLD = 0.4;
const MIN_FACE_SIZE = 20;
const MAX_FACES = 256;
const STRIDES = [8, 16, 32] as const;

interface OutputGroup {
  anchorCount: number;
  scores?: Float32Array;
  bboxes?: Float32Array;
  kps?: Float32Array;
}

function getModelInputSizes(
  session: ort.InferenceSession,
  maxDimension: number,
): readonly number[] {
  try {
    const metadata = (session as unknown as Record<string, unknown>).inputMetadata;
    const inputMeta = Array.isArray(metadata) ? metadata[0] : undefined;
    const rawShape =
      inputMeta &&
      typeof inputMeta === "object" &&
      "isTensor" in inputMeta &&
      inputMeta.isTensor === true &&
      "shape" in inputMeta
        ? (inputMeta as { shape?: unknown }).shape
        : undefined;
    const shape = Array.isArray(rawShape) ? rawShape : [];
    const heightDim = shape[2];
    const widthDim = shape[3];
    const hasFixedSquareInput =
      typeof heightDim === "number" &&
      typeof widthDim === "number" &&
      Number.isFinite(heightDim) &&
      Number.isFinite(widthDim) &&
      heightDim > 0 &&
      widthDim > 0 &&
      heightDim === widthDim;

    if (hasFixedSquareInput) {
      return [heightDim];
    }
  } catch {
    // inputMetadata may not exist in all onnxruntime versions
  }

  return maxDimension >= 900
    ? PREFERRED_DYNAMIC_INPUT_SIZES
    : PREFERRED_DYNAMIC_INPUT_SIZES.slice(0, 1);
}

export function iou(a: DetectedFace["box"], b: DetectedFace["box"]): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function nms(faces: DetectedFace[]): DetectedFace[] {
  const sorted = [...faces].sort((a, b) => b.confidence - a.confidence);
  const keep: DetectedFace[] = [];

  for (const face of sorted) {
    let suppressed = false;
    for (const kept of keep) {
      if (iou(face.box, kept.box) > NMS_THRESHOLD) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) keep.push(face);
  }

  return keep;
}

export function decodeOutputs(
  scores: Float32Array,
  bboxes: Float32Array,
  kps: Float32Array,
  confidenceThreshold: number,
  stride: number,
  featH: number,
  featW: number,
  anchorCount: number,
  minFaceSize: number,
  scaleX: number,
  scaleY: number,
): DetectedFace[] {
  const faces: DetectedFace[] = [];
  if (anchorCount <= 0) return faces;

  const scoreChannels = Math.max(1, Math.floor(scores.length / anchorCount));
  const anchorsPerLocation = Math.max(1, Math.round(anchorCount / (featH * featW)));

  for (let i = 0; i < anchorCount; i++) {
    const score =
      scoreChannels === 1
        ? (scores[i] ?? 0)
        : (scores[i * scoreChannels + 1] ?? scores[i * scoreChannels] ?? 0);
    if (score < confidenceThreshold) continue;

    const locationIdx = Math.floor(i / anchorsPerLocation);
    const row = Math.floor(locationIdx / featW);
    const col = locationIdx % featW;
    const cx = (col + 0.5) * stride;
    const cy = (row + 0.5) * stride;

    const bboxIdx = i * 4;
    const x1 = (cx - (bboxes[bboxIdx] ?? 0) * stride) * scaleX;
    const y1 = (cy - (bboxes[bboxIdx + 1] ?? 0) * stride) * scaleY;
    const x2 = (cx + (bboxes[bboxIdx + 2] ?? 0) * stride) * scaleX;
    const y2 = (cy + (bboxes[bboxIdx + 3] ?? 0) * stride) * scaleY;

    const landmarks: number[][] = [];
    for (let j = 0; j < 5; j++) {
      const kpIdx = i * 10 + j * 2;
      landmarks.push([
        (cx + (kps[kpIdx] ?? 0) * stride) * scaleX,
        (cy + (kps[kpIdx + 1] ?? 0) * stride) * scaleY,
      ]);
    }

    faces.push({
      box: {
        x: Math.round(Math.max(0, x1)),
        y: Math.round(Math.max(0, y1)),
        width: Math.round(Math.max(0, x2 - x1)),
        height: Math.round(Math.max(0, y2 - y1)),
      },
      landmarks,
      confidence: score,
    });
  }

  return faces.filter(
    (face) =>
      face.box.width >= minFaceSize &&
      face.box.height >= minFaceSize &&
      face.box.width / face.box.height >= 0.3 &&
      face.box.width / face.box.height <= 3.0 &&
      Number.isFinite(face.box.x) &&
      Number.isFinite(face.box.y),
  );
}

function inferKindFromOutput(name: string, tensor: ort.Tensor): "score" | "bbox" | "kps" | null {
  const dims = tensor.dims;
  const lastDim = dims[dims.length - 1];
  if (lastDim === 10) return "kps";
  if (lastDim === 4) return "bbox";
  if (lastDim === 1 || lastDim === 2) return "score";

  const lowerName = name.toLowerCase();
  if (lowerName.includes("kps") || lowerName.includes("landmark")) return "kps";
  if (lowerName.includes("bbox") || lowerName.includes("box")) return "bbox";
  if (lowerName.includes("score") || lowerName.includes("cls") || lowerName.includes("conf")) {
    return "score";
  }
  return null;
}

function inferAnchorCount(kind: "score" | "bbox" | "kps", tensor: ort.Tensor): number | null {
  const dataLength = tensor.data.length;
  const dims = tensor.dims;
  const lastDim = dims[dims.length - 1];

  if (typeof lastDim === "number" && lastDim > 0 && dataLength % lastDim === 0) {
    return dataLength / lastDim;
  }

  if (kind === "kps" && dataLength % 10 === 0) return dataLength / 10;
  if (kind === "bbox" && dataLength % 4 === 0) return dataLength / 4;
  if (kind === "score") return dataLength;
  return null;
}

function groupModelOutputs(results: Record<string, ort.Tensor>): OutputGroup[] {
  const grouped = new Map<number, OutputGroup>();

  for (const [name, tensor] of Object.entries(results)) {
    const kind = inferKindFromOutput(name, tensor);
    if (!kind) continue;

    const anchorCount = inferAnchorCount(kind, tensor);
    if (!anchorCount) continue;

    const existing = grouped.get(anchorCount) ?? { anchorCount };
    const data = tensor.data as Float32Array;

    if (kind === "score" && !existing.scores) existing.scores = data;
    if (kind === "bbox" && !existing.bboxes) existing.bboxes = data;
    if (kind === "kps" && !existing.kps) existing.kps = data;

    grouped.set(anchorCount, existing);
  }

  return Array.from(grouped.values())
    .filter((group) => group.scores && group.bboxes && group.kps)
    .sort((a, b) => b.anchorCount - a.anchorCount);
}

async function runScaleDetection(
  session: ort.InferenceSession,
  imageBuffer: Buffer,
  origWidth: number,
  origHeight: number,
  inputSize: number,
): Promise<DetectedFace[]> {
  const scale = Math.min(inputSize / origWidth, inputSize / origHeight);
  const resizedW = Math.max(1, Math.round(origWidth * scale));
  const resizedH = Math.max(1, Math.round(origHeight * scale));

  const padded = await sharp(imageBuffer)
    .resize(resizedW, resizedH, { fit: "fill" })
    .extend({
      top: 0,
      bottom: inputSize - resizedH,
      left: 0,
      right: inputSize - resizedW,
      background: { r: 0, g: 0, b: 0 },
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  const pixelCount = inputSize * inputSize;
  const float32Data = new Float32Array(3 * pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    float32Data[i] = (padded[i * 3]! - 127.5) / 128.0;
    float32Data[pixelCount + i] = (padded[i * 3 + 1]! - 127.5) / 128.0;
    float32Data[pixelCount * 2 + i] = (padded[i * 3 + 2]! - 127.5) / 128.0;
  }

  const inputTensor = new ort.Tensor("float32", float32Data, [1, 3, inputSize, inputSize]);
  const inputName = session.inputNames[0] ?? "input.1";
  const results = await session.run({ [inputName]: inputTensor });

  const scaleX = origWidth / resizedW;
  const scaleY = origHeight / resizedH;
  const groupedOutputs = groupModelOutputs(results);
  const minFaceSize = Math.max(MIN_FACE_SIZE, Math.round(Math.min(origWidth, origHeight) * 0.02));
  const confidenceThreshold = CONFIDENCE_THRESHOLD;
  let allFaces: DetectedFace[] = [];

  for (let si = 0; si < STRIDES.length; si++) {
    const stride = STRIDES[si]!;
    const featH = Math.ceil(inputSize / stride);
    const featW = Math.ceil(inputSize / stride);
    const group = groupedOutputs[si];
    if (!group?.scores || !group.bboxes || !group.kps) continue;

    const faces = decodeOutputs(
      group.scores,
      group.bboxes,
      group.kps,
      confidenceThreshold,
      stride,
      featH,
      featW,
      group.anchorCount,
      minFaceSize,
      scaleX,
      scaleY,
    );
    allFaces = allFaces.concat(faces);
  }

  return nms(allFaces);
}

export async function detectFaces(
  imageBuffer: Buffer,
): Promise<{ faces: DetectedFace[]; imageWidth: number; imageHeight: number }> {
  const session = await loadDetectionSession();
  const metadata = await sharp(imageBuffer).metadata();
  const origWidth = metadata.width!;
  const origHeight = metadata.height!;
  const maxDimension = Math.max(origWidth, origHeight);
  const scales = getModelInputSizes(session, maxDimension);

  let allFaces: DetectedFace[] = [];
  for (const inputSize of scales) {
    const faces = await runScaleDetection(session, imageBuffer, origWidth, origHeight, inputSize);
    allFaces = allFaces.concat(faces);
  }

  const finalFaces = nms(allFaces)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_FACES);
  console.log(
    `[face-detection] Detected ${finalFaces.length} faces (before final NMS: ${allFaces.length}) in ${origWidth}x${origHeight} image`,
  );
  return { faces: finalFaces, imageWidth: origWidth, imageHeight: origHeight };
}
