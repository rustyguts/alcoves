import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as ort from "onnxruntime-node";

const MODELS_DIR = resolve("data/.models");
const MODEL_PACK = "insightface-compatible (scrfd_34g + glintr100)";

const MODEL_URLS: Record<string, string[]> = {
  "detection-model.onnx": [
    "https://huggingface.co/immich-app/scrfd_34g_gnkps/resolve/main/detection/model.onnx",
    "https://huggingface.co/immich-app/scrfd_34g_gnkps/resolve/main/detection/model.onnx?download=true",
    "https://huggingface.co/immich-app/antelopev2/resolve/main/detection/model.onnx",
  ],
  "recognition-model.onnx": [
    "https://huggingface.co/immich-app/antelopev2/resolve/main/recognition/model.onnx",
    "https://huggingface.co/immich-app/antelopev2/resolve/main/recognition/model.onnx?download=true",
    "https://huggingface.co/aiartphp/antelopev2/resolve/main/glintr100.onnx",
  ],
};

let detectionSession: ort.InferenceSession | null = null;
let recognitionSession: ort.InferenceSession | null = null;

async function downloadModel(filename: string): Promise<string> {
  const filepath = join(MODELS_DIR, filename);
  if (existsSync(filepath)) return filepath;

  const urls = MODEL_URLS[filename];
  if (!urls?.length) throw new Error(`Unknown model: ${filename}`);

  console.log(`[models] Downloading ${filename}...`);
  await mkdir(MODELS_DIR, { recursive: true });

  const errors: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": "alcoves-face-worker/1.0",
        },
      });

      if (!response.ok) {
        errors.push(`${url} -> ${response.status} ${response.statusText}`);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const head = buffer.subarray(0, 120).toString("utf8");
      if (
        buffer.length < 1024 * 1024 ||
        head.includes("git-lfs.github.com/spec/v1") ||
        head.startsWith("<!doctype html")
      ) {
        errors.push(`${url} -> invalid payload (${buffer.length} bytes)`);
        continue;
      }

      await writeFile(filepath, buffer);
      console.log(`[models] Downloaded ${filename} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
      return filepath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${url} -> ${message}`);
    }
  }

  throw new Error(`Failed to download ${filename}: ${errors.join(" | ")}`);
}

export async function ensureModelsDownloaded(): Promise<void> {
  await Promise.all(Object.keys(MODEL_URLS).map(downloadModel));
}

export async function loadDetectionSession(): Promise<ort.InferenceSession> {
  if (detectionSession) return detectionSession;

  const modelPath = await downloadModel("detection-model.onnx");
  detectionSession = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
  });
  console.log(`[models] Detection model loaded (${MODEL_PACK})`);
  return detectionSession;
}

export async function loadRecognitionSession(): Promise<ort.InferenceSession> {
  if (recognitionSession) return recognitionSession;

  const modelPath = await downloadModel("recognition-model.onnx");
  recognitionSession = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
  });
  console.log(`[models] Recognition model loaded (${MODEL_PACK})`);
  return recognitionSession;
}
