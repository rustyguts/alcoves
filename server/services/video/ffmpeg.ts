import { spawn } from "node:child_process";

/**
 * Low-level ffmpeg/ffprobe wrappers. Every function shells out to the
 * system-installed ffmpeg binary — no native Node bindings needed.
 */

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

export interface VideoProbe {
  codec: string;
  width: number;
  height: number;
  duration: number; // seconds
  bitrate: number; // bps
  audioCodec: string | null;
  isHdr: boolean;
}

/**
 * Run ffprobe on a file path and extract video stream metadata.
 */
export async function probeVideo(filePath: string): Promise<VideoProbe> {
  const args = ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath];

  const raw = await run("ffprobe", args);
  const data = JSON.parse(raw);

  const videoStream = data.streams?.find((s: Record<string, unknown>) => s.codec_type === "video");
  const audioStream = data.streams?.find((s: Record<string, unknown>) => s.codec_type === "audio");

  if (!videoStream) {
    throw new Error("No video stream found");
  }

  const width = Number(videoStream.width) || 0;
  const height = Number(videoStream.height) || 0;
  const duration = Number(videoStream.duration) || Number(data.format?.duration) || 0;
  const bitrate = Number(videoStream.bit_rate) || Number(data.format?.bit_rate) || 0;

  // HDR detection: check for bt2020 color space or high bit depth
  const colorSpace = String(videoStream.color_space || "");
  const colorTransfer = String(videoStream.color_transfer || "");
  const bitsPerRaw = Number(videoStream.bits_per_raw_sample) || 8;
  const isHdr =
    colorSpace.includes("bt2020") ||
    colorTransfer.includes("smpte2084") ||
    colorTransfer.includes("arib-std-b67") ||
    bitsPerRaw > 8;

  return {
    codec: String(videoStream.codec_name || "unknown"),
    width,
    height,
    duration: Math.round(duration),
    bitrate,
    audioCodec: audioStream ? String(audioStream.codec_name) : null,
    isHdr,
  };
}

// ---------------------------------------------------------------------------
// Browser compatibility check
// ---------------------------------------------------------------------------

/** Codecs that browsers can play natively (H.264, VP8, VP9, AV1). */
const BROWSER_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const BROWSER_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis", "flac", null]);

export function isBrowserPlayable(probe: VideoProbe): boolean {
  if (!BROWSER_VIDEO_CODECS.has(probe.codec)) return false;
  if (!BROWSER_AUDIO_CODECS.has(probe.audioCodec)) return false;
  if (probe.isHdr) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Thumbnail generation
// ---------------------------------------------------------------------------

/**
 * Extract a single JPEG thumbnail from a video at the given timestamp.
 * Returns the JPEG buffer.
 */
export async function generateThumbnail(
  inputPath: string,
  options: { timestamp?: number; width?: number; height?: number } = {},
): Promise<Buffer> {
  const { timestamp = 1, width = 640, height = -2 } = options;

  const args = [
    "-ss",
    String(timestamp),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    `scale=${width}:${height}`,
    "-f",
    "image2",
    "-c:v",
    "mjpeg",
    "-q:v",
    "4",
    "pipe:1",
  ];

  return runBuffer("ffmpeg", args);
}

// ---------------------------------------------------------------------------
// Transcode to browser-friendly proxy
// ---------------------------------------------------------------------------

export interface TranscodeOptions {
  inputPath: string;
  outputPath: string;
  maxHeight?: number;
  crf?: number;
  preset?: string;
  audioBitrate?: string;
  onProgress?: (percent: number) => void;
}

/**
 * Transcode a video to H.264/AAC MP4 — the fastest-to-encode format that
 * all browsers can play. Uses `ultrafast` preset by default for speed;
 * callers can override with `fast` or `medium` for smaller files.
 *
 * Resolution is capped at 1080p (height=1080) by default.
 */
export async function transcodeToProxy(opts: TranscodeOptions): Promise<void> {
  const {
    inputPath,
    outputPath,
    maxHeight = 1080,
    crf = 23,
    preset = "fast",
    audioBitrate = "128k",
    onProgress,
  } = opts;

  // Scale filter: cap height at maxHeight, keep aspect ratio, ensure even dimensions
  const scaleFilter = `scale=-2:'min(${maxHeight},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;

  const args = [
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    String(crf),
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-vf",
    scaleFilter,
    "-c:a",
    "aac",
    "-b:a",
    audioBitrate,
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];

  if (onProgress) {
    await runWithProgress("ffmpeg", args, onProgress);
  } else {
    await run("ffmpeg", args);
  }
}

// ---------------------------------------------------------------------------
// Clip extraction
// ---------------------------------------------------------------------------

export interface ClipOptions {
  inputPath: string;
  outputPath: string;
  startTime: number; // seconds
  endTime: number; // seconds
}

/**
 * Extract a clip from a video between startTime and endTime.
 * Uses stream copy when the source is already H.264/AAC to avoid re-encoding.
 * Falls back to re-encoding for other codecs.
 */
export async function extractClip(opts: ClipOptions): Promise<void> {
  const { inputPath, outputPath, startTime, endTime } = opts;
  const duration = endTime - startTime;

  if (duration <= 0) {
    throw new Error("End time must be after start time");
  }

  // Try stream copy first (instant, no quality loss for H.264 sources).
  // If the source is a different codec, ffmpeg will fail and we re-encode.
  const args = [
    "-ss",
    String(startTime),
    "-i",
    inputPath,
    "-t",
    String(duration),
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];

  try {
    await run("ffmpeg", args);
  } catch {
    // Fallback: re-encode the clip
    const reencodeArgs = [
      "-ss",
      String(startTime),
      "-i",
      inputPath,
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ];
    await run("ffmpeg", reencodeArgs);
  }
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    proc.stdout.on("data", (chunk) => stdout.push(chunk));
    proc.stderr.on("data", (chunk) => stderr.push(chunk));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf-8"));
      } else {
        reject(
          new Error(
            `${cmd} exited with code ${code}: ${Buffer.concat(stderr).toString("utf-8").slice(0, 500)}`,
          ),
        );
      }
    });

    proc.on("error", reject);
  });
}

function runBuffer(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    proc.stdout.on("data", (chunk) => stdout.push(chunk));
    proc.stderr.on("data", (chunk) => stderr.push(chunk));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
      } else {
        reject(
          new Error(
            `${cmd} exited with code ${code}: ${Buffer.concat(stderr).toString("utf-8").slice(0, 500)}`,
          ),
        );
      }
    });

    proc.on("error", reject);
  });
}

function runWithProgress(
  cmd: string,
  args: string[],
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Add -progress pipe:2 for ffmpeg progress reporting
    const fullArgs = [...args.slice(0, -2), "-progress", "pipe:2", ...args.slice(-2)];
    const proc = spawn(cmd, fullArgs);
    let durationMs = 0;

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();

      // Parse duration from initial output
      const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
      if (durMatch) {
        durationMs =
          (Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])) *
            1_000_000 +
          Number(durMatch[4]) * 10_000;
      }

      // Parse progress from -progress output
      const timeMatch = text.match(/out_time_us=(\d+)/);
      if (timeMatch && durationMs > 0) {
        const currentUs = Number(timeMatch[1]);
        const pct = Math.min(100, Math.round((currentUs / durationMs) * 100));
        onProgress(pct);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}`));
      }
    });

    proc.on("error", reject);
  });
}
