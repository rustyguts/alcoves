import sharp from "sharp";
import * as ort from "onnxruntime-node";
import { loadRecognitionSession } from "./models";
import type { DetectedFace } from "./detect";

const ALIGNED_SIZE = 112;

// Standard 5-point alignment template for 112x112 face images
const REFERENCE_LANDMARKS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

function estimateAffineTransform(
  src: number[][],
  dst: number[][],
): { a: number; b: number; c: number; d: number; tx: number; ty: number } {
  // Solve least squares for 2x3 affine matrix using 5-point correspondences
  let sumSx = 0,
    sumSy = 0,
    sumDx = 0,
    sumDy = 0;
  let sumSxSx = 0,
    sumSySy = 0;
  let sumSxDx = 0,
    sumSyDx = 0,
    sumSxDy = 0,
    sumSyDy = 0;
  const n = src.length;

  for (let i = 0; i < n; i++) {
    const sx = src[i]![0]!,
      sy = src[i]![1]!;
    const dx = dst[i]![0]!,
      dy = dst[i]![1]!;
    sumSx += sx;
    sumSy += sy;
    sumDx += dx;
    sumDy += dy;
    sumSxSx += sx * sx;
    sumSySy += sy * sy;
    sumSxDx += sx * dx;
    sumSyDx += sy * dx;
    sumSxDy += sx * dy;
    sumSyDy += sy * dy;
  }

  // Similarity transform (a, b, tx, ty) where:
  // dx = a*sx - b*sy + tx
  // dy = b*sx + a*sy + ty
  const det = n * (sumSxSx + sumSySy) - sumSx * sumSx - sumSy * sumSy;
  if (Math.abs(det) < 1e-10) {
    return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  }

  const a = (n * (sumSxDx + sumSyDy) - sumSx * sumDx - sumSy * sumDy) / det;
  const b = (n * (sumSxDy - sumSyDx) - sumSx * sumDy + sumSy * sumDx) / det;
  const tx = (sumDx - a * sumSx + b * sumSy) / n;
  const ty = (sumDy - b * sumSx - a * sumSy) / n;

  return { a, b: -b, c: b, d: a, tx, ty };
}

async function alignFace(imageBuffer: Buffer, landmarks: number[][]): Promise<Buffer> {
  // Compute forward transform: src landmarks → 112x112 reference landmarks
  const fwd = estimateAffineTransform(landmarks, REFERENCE_LANDMARKS);

  // Compute inverse transform (from 112x112 output space → input image space)
  const det = fwd.a * fwd.d - fwd.b * fwd.c;
  if (Math.abs(det) < 1e-10) {
    // Degenerate transform — fall back to center-crop + resize
    const metadata = await sharp(imageBuffer).metadata();
    const cx = landmarks.reduce((s, l) => s + l[0]!, 0) / landmarks.length;
    const cy = landmarks.reduce((s, l) => s + l[1]!, 0) / landmarks.length;
    const size = Math.max(
      ALIGNED_SIZE,
      Math.round(
        Math.max(
          ...landmarks.map(
            (l) => Math.abs(l[0]! - cx),
            ...landmarks.map((l) => Math.abs(l[1]! - cy)),
          ),
        ) * 3,
      ),
    );
    const left = Math.max(0, Math.round(cx - size / 2));
    const top = Math.max(0, Math.round(cy - size / 2));
    const w = Math.min(size, (metadata.width ?? size) - left);
    const h = Math.min(size, (metadata.height ?? size) - top);
    return await sharp(imageBuffer)
      .extract({ left, top, width: w, height: h })
      .resize(ALIGNED_SIZE, ALIGNED_SIZE)
      .removeAlpha()
      .raw()
      .toBuffer();
  }

  const invA = fwd.d / det;
  const invB = -fwd.b / det;
  const invC = -fwd.c / det;
  const invD = fwd.a / det;
  const invTx = -(invA * fwd.tx + invB * fwd.ty);
  const invTy = -(invC * fwd.tx + invD * fwd.ty);

  // Find the input bounding box needed for the 112x112 output
  const outCorners = [
    [0, 0],
    [ALIGNED_SIZE, 0],
    [0, ALIGNED_SIZE],
    [ALIGNED_SIZE, ALIGNED_SIZE],
  ];
  const mappedX = outCorners.map(([ox, oy]) => invA * ox! + invB * oy! + invTx);
  const mappedY = outCorners.map(([ox, oy]) => invC * ox! + invD * oy! + invTy);

  const metadata = await sharp(imageBuffer).metadata();
  const imgW = metadata.width!;
  const imgH = metadata.height!;

  const cropLeft = Math.max(0, Math.floor(Math.min(...mappedX)) - 2);
  const cropTop = Math.max(0, Math.floor(Math.min(...mappedY)) - 2);
  const cropRight = Math.min(imgW, Math.ceil(Math.max(...mappedX)) + 3);
  const cropBottom = Math.min(imgH, Math.ceil(Math.max(...mappedY)) + 3);
  const cropW = Math.max(1, cropRight - cropLeft);
  const cropH = Math.max(1, cropBottom - cropTop);

  // Decode only the needed input region to raw RGB pixels
  const pixels = await sharp(imageBuffer)
    .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
    .removeAlpha()
    .raw()
    .toBuffer();

  // Adjust inverse transform for crop offset
  const adjTx = invTx - cropLeft;
  const adjTy = invTy - cropTop;

  // Warp to 112x112 with bilinear interpolation (equivalent to cv2.warpAffine)
  const output = Buffer.alloc(ALIGNED_SIZE * ALIGNED_SIZE * 3);

  for (let oy = 0; oy < ALIGNED_SIZE; oy++) {
    for (let ox = 0; ox < ALIGNED_SIZE; ox++) {
      const ix = invA * ox + invB * oy + adjTx;
      const iy = invC * ox + invD * oy + adjTy;

      const x0 = Math.floor(ix);
      const y0 = Math.floor(iy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const fx = ix - x0;
      const fy = iy - y0;

      const outIdx = (oy * ALIGNED_SIZE + ox) * 3;
      for (let c = 0; c < 3; c++) {
        const p00 =
          x0 >= 0 && x0 < cropW && y0 >= 0 && y0 < cropH
            ? (pixels[(y0 * cropW + x0) * 3 + c] ?? 0)
            : 0;
        const p10 =
          x1 >= 0 && x1 < cropW && y0 >= 0 && y0 < cropH
            ? (pixels[(y0 * cropW + x1) * 3 + c] ?? 0)
            : 0;
        const p01 =
          x0 >= 0 && x0 < cropW && y1 >= 0 && y1 < cropH
            ? (pixels[(y1 * cropW + x0) * 3 + c] ?? 0)
            : 0;
        const p11 =
          x1 >= 0 && x1 < cropW && y1 >= 0 && y1 < cropH
            ? (pixels[(y1 * cropW + x1) * 3 + c] ?? 0)
            : 0;

        const value =
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
        output[outIdx + c] = Math.round(Math.max(0, Math.min(255, value)));
      }
    }
  }

  return output;
}

export async function computeEmbedding(
  imageBuffer: Buffer,
  face: DetectedFace,
): Promise<Float32Array> {
  const session = await loadRecognitionSession();

  const alignedRaw = await alignFace(imageBuffer, face.landmarks);

  // HWC -> CHW float32, normalize to [-1, 1]
  const float32Data = new Float32Array(3 * ALIGNED_SIZE * ALIGNED_SIZE);
  const totalPixels = ALIGNED_SIZE * ALIGNED_SIZE;

  for (let i = 0; i < totalPixels; i++) {
    float32Data[i] = (alignedRaw[i * 3]! - 127.5) / 127.5;
    float32Data[totalPixels + i] = (alignedRaw[i * 3 + 1]! - 127.5) / 127.5;
    float32Data[2 * totalPixels + i] = (alignedRaw[i * 3 + 2]! - 127.5) / 127.5;
  }

  const inputTensor = new ort.Tensor("float32", float32Data, [1, 3, ALIGNED_SIZE, ALIGNED_SIZE]);
  const inputName = session.inputNames[0] ?? "data";
  const results = await session.run({ [inputName]: inputTensor });

  // Get the first output (the embedding)
  const outputName = session.outputNames[0]!;
  const rawEmbedding = results[outputName]!.data as Float32Array;

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < rawEmbedding.length; i++) {
    norm += rawEmbedding[i]! * rawEmbedding[i]!;
  }
  norm = Math.sqrt(norm);

  const normalized = new Float32Array(rawEmbedding.length);
  if (norm > 0) {
    for (let i = 0; i < rawEmbedding.length; i++) {
      normalized[i] = rawEmbedding[i]! / norm;
    }
  }

  return normalized;
}
