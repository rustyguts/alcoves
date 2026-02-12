function parseNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const FACE_DETECTION_MIN_SCORE = clamp(
  parseNumber("ALCOVES_FACE_DETECTION_MIN_SCORE", 0.5),
  0.05,
  0.99,
);

export const FACE_RECOGNITION_MAX_DISTANCE = clamp(
  parseNumber("ALCOVES_FACE_RECOGNITION_MAX_DISTANCE", 0.6),
  0.2,
  0.8,
);

export const FACE_RECOGNITION_NEIGHBOR_LOOKUP = Math.max(
  parseInteger("ALCOVES_FACE_RECOGNITION_NEIGHBOR_LOOKUP", 80),
  1,
);

export const FACE_RECOGNITION_MIN_FACES = Math.max(
  parseInteger("ALCOVES_FACE_RECOGNITION_MIN_FACES", 2),
  1,
);
