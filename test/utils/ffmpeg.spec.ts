import type { VideoProbe } from "~~/server/services/video/ffmpeg";

/**
 * Mock child_process.spawn so we never call real ffmpeg/ffprobe.
 * Each test configures its own spawn behaviour.
 */
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock(import("node:child_process"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual, spawn: spawnMock },
    spawn: spawnMock,
  };
});

/**
 * Tiny EventEmitter-like helper for simulating ChildProcess.
 */
function makeFakeProcess(
  stdoutData?: string | Buffer,
  stderrData?: string | Buffer,
  exitCode = 0,
) {
  const stdoutListeners: Record<string, Function[]> = {};
  const stderrListeners: Record<string, Function[]> = {};
  const procListeners: Record<string, Function[]> = {};

  const proc = {
    stdout: {
      on(event: string, fn: Function) {
        (stdoutListeners[event] ??= []).push(fn);
      },
    },
    stderr: {
      on(event: string, fn: Function) {
        (stderrListeners[event] ??= []).push(fn);
      },
    },
    on(event: string, fn: Function) {
      (procListeners[event] ??= []).push(fn);
    },
    _emit() {
      if (stdoutData != null) {
        for (const fn of stdoutListeners["data"] ?? []) {
          fn(Buffer.isBuffer(stdoutData) ? stdoutData : Buffer.from(stdoutData));
        }
      }
      if (stderrData != null) {
        for (const fn of stderrListeners["data"] ?? []) {
          fn(Buffer.isBuffer(stderrData) ? stderrData : Buffer.from(stderrData));
        }
      }
      queueMicrotask(() => {
        for (const fn of procListeners["close"] ?? []) fn(exitCode);
      });
    },
  };

  return proc;
}

describe("ffmpeg utilities", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  // -----------------------------------------------------------------------
  // probeVideo
  // -----------------------------------------------------------------------
  describe("probeVideo", () => {
    it("parses ffprobe JSON output into VideoProbe", async () => {
      const ffprobeOutput = JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
            duration: "120.5",
            bit_rate: "5000000",
            color_space: "bt709",
            color_transfer: "bt709",
            bits_per_raw_sample: "8",
          },
          {
            codec_type: "audio",
            codec_name: "aac",
          },
        ],
        format: { duration: "120.5", bit_rate: "5500000" },
      });

      const proc = makeFakeProcess(ffprobeOutput);
      spawnMock.mockReturnValueOnce(proc);

      // Import after mock
      const { probeVideo } = await import("~~/server/services/video/ffmpeg");

      // Trigger the proc events on next tick
      queueMicrotask(() => proc._emit());

      const result = await probeVideo("/tmp/test.mp4");

      expect(result.codec).toBe("h264");
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.duration).toBe(121); // Math.round(120.5)
      expect(result.bitrate).toBe(5000000);
      expect(result.audioCodec).toBe("aac");
      expect(result.isHdr).toBe(false);

      // Verify ffprobe was called with correct args
      expect(spawnMock).toHaveBeenCalledWith("ffprobe", [
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        "/tmp/test.mp4",
      ]);
    });

    it("throws when no video stream is found", async () => {
      const ffprobeOutput = JSON.stringify({
        streams: [{ codec_type: "audio", codec_name: "aac" }],
        format: {},
      });

      const proc = makeFakeProcess(ffprobeOutput);
      spawnMock.mockReturnValueOnce(proc);

      const { probeVideo } = await import("~~/server/services/video/ffmpeg");
      queueMicrotask(() => proc._emit());

      await expect(probeVideo("/tmp/audio-only.mp4")).rejects.toThrow("No video stream found");
    });

    it("detects HDR from bt2020 color space", async () => {
      const ffprobeOutput = JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "hevc",
            width: 3840,
            height: 2160,
            duration: "60",
            bit_rate: "20000000",
            color_space: "bt2020nc",
            color_transfer: "smpte2084",
            bits_per_raw_sample: "10",
          },
        ],
        format: {},
      });

      const proc = makeFakeProcess(ffprobeOutput);
      spawnMock.mockReturnValueOnce(proc);

      const { probeVideo } = await import("~~/server/services/video/ffmpeg");
      queueMicrotask(() => proc._emit());

      const result = await probeVideo("/tmp/hdr.mkv");
      expect(result.isHdr).toBe(true);
      expect(result.codec).toBe("hevc");
    });

    it("falls back to format duration when stream duration is missing", async () => {
      const ffprobeOutput = JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1280,
            height: 720,
            color_space: "",
            color_transfer: "",
            bits_per_raw_sample: "8",
          },
        ],
        format: { duration: "90.0", bit_rate: "3000000" },
      });

      const proc = makeFakeProcess(ffprobeOutput);
      spawnMock.mockReturnValueOnce(proc);

      const { probeVideo } = await import("~~/server/services/video/ffmpeg");
      queueMicrotask(() => proc._emit());

      const result = await probeVideo("/tmp/no-stream-dur.mp4");
      expect(result.duration).toBe(90);
      expect(result.bitrate).toBe(3000000); // from format.bit_rate
    });

    it("throws when ffprobe exits with non-zero code", async () => {
      const proc = makeFakeProcess(undefined, "Error occurred", 1);
      spawnMock.mockReturnValueOnce(proc);

      const { probeVideo } = await import("~~/server/services/video/ffmpeg");
      queueMicrotask(() => proc._emit());

      await expect(probeVideo("/tmp/bad.mp4")).rejects.toThrow("ffprobe exited with code 1");
    });
  });

  // -----------------------------------------------------------------------
  // isBrowserPlayable
  // -----------------------------------------------------------------------
  describe("isBrowserPlayable", () => {
    // We can import this synchronously since it's a pure function with no spawn
    let isBrowserPlayable: (probe: VideoProbe) => boolean;

    beforeAll(async () => {
      const mod = await import("~~/server/services/video/ffmpeg");
      isBrowserPlayable = mod.isBrowserPlayable;
    });

    it("returns true for H.264/AAC (standard web video)", () => {
      const probe: VideoProbe = {
        codec: "h264",
        width: 1920,
        height: 1080,
        duration: 120,
        bitrate: 5000000,
        audioCodec: "aac",
        isHdr: false,
      };
      expect(isBrowserPlayable(probe)).toBe(true);
    });

    it("returns true for VP9/Opus", () => {
      const probe: VideoProbe = {
        codec: "vp9",
        width: 1920,
        height: 1080,
        duration: 120,
        bitrate: 5000000,
        audioCodec: "opus",
        isHdr: false,
      };
      expect(isBrowserPlayable(probe)).toBe(true);
    });

    it("returns true for AV1/FLAC", () => {
      const probe: VideoProbe = {
        codec: "av1",
        width: 3840,
        height: 2160,
        duration: 60,
        bitrate: 10000000,
        audioCodec: "flac",
        isHdr: false,
      };
      expect(isBrowserPlayable(probe)).toBe(true);
    });

    it("returns true for video with no audio", () => {
      const probe: VideoProbe = {
        codec: "h264",
        width: 1920,
        height: 1080,
        duration: 10,
        bitrate: 5000000,
        audioCodec: null,
        isHdr: false,
      };
      expect(isBrowserPlayable(probe)).toBe(true);
    });

    it("returns false for HEVC (not universally supported)", () => {
      const probe: VideoProbe = {
        codec: "hevc",
        width: 1920,
        height: 1080,
        duration: 120,
        bitrate: 5000000,
        audioCodec: "aac",
        isHdr: false,
      };
      expect(isBrowserPlayable(probe)).toBe(false);
    });

    it("returns false for ProRes", () => {
      const probe: VideoProbe = {
        codec: "prores",
        width: 1920,
        height: 1080,
        duration: 120,
        bitrate: 150000000,
        audioCodec: "pcm_s16le",
        isHdr: false,
      };
      expect(isBrowserPlayable(probe)).toBe(false);
    });

    it("returns false for unsupported audio codec (e.g. AC3)", () => {
      const probe: VideoProbe = {
        codec: "h264",
        width: 1920,
        height: 1080,
        duration: 120,
        bitrate: 5000000,
        audioCodec: "ac3",
        isHdr: false,
      };
      expect(isBrowserPlayable(probe)).toBe(false);
    });

    it("returns false for HDR content (even with compatible codecs)", () => {
      const probe: VideoProbe = {
        codec: "h264",
        width: 3840,
        height: 2160,
        duration: 120,
        bitrate: 20000000,
        audioCodec: "aac",
        isHdr: true,
      };
      expect(isBrowserPlayable(probe)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // generateThumbnail
  // -----------------------------------------------------------------------
  describe("generateThumbnail", () => {
    it("calls ffmpeg with correct args and returns JPEG buffer", async () => {
      const jpegData = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG magic bytes
      const proc = makeFakeProcess(jpegData);
      spawnMock.mockReturnValueOnce(proc);

      const { generateThumbnail } = await import("~~/server/services/video/ffmpeg");
      queueMicrotask(() => proc._emit());

      const result = await generateThumbnail("/tmp/video.mp4", { timestamp: 5, width: 320 });
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result[0]).toBe(0xFF); // JPEG magic

      // Verify ffmpeg args
      expect(spawnMock).toHaveBeenCalledWith("ffmpeg", expect.arrayContaining([
        "-ss", "5",
        "-i", "/tmp/video.mp4",
        "-frames:v", "1",
        "-vf", "scale=320:-2",
        "-f", "image2",
        "-c:v", "mjpeg",
        "pipe:1",
      ]));
    });

    it("uses default options (timestamp=1, width=640)", async () => {
      const proc = makeFakeProcess(Buffer.from("fake-jpeg"));
      spawnMock.mockReturnValueOnce(proc);

      const { generateThumbnail } = await import("~~/server/services/video/ffmpeg");
      queueMicrotask(() => proc._emit());

      await generateThumbnail("/tmp/video.mp4");

      expect(spawnMock).toHaveBeenCalledWith("ffmpeg", expect.arrayContaining([
        "-ss", "1",
        "-vf", "scale=640:-2",
      ]));
    });
  });

  // -----------------------------------------------------------------------
  // transcodeToProxy
  // -----------------------------------------------------------------------
  describe("transcodeToProxy", () => {
    it("calls ffmpeg with H.264/AAC 1080p args", async () => {
      const proc = makeFakeProcess("");
      spawnMock.mockReturnValueOnce(proc);

      const { transcodeToProxy } = await import("~~/server/services/video/ffmpeg");
      queueMicrotask(() => proc._emit());

      await transcodeToProxy({
        inputPath: "/tmp/input.mkv",
        outputPath: "/tmp/output.mp4",
      });

      expect(spawnMock).toHaveBeenCalledWith("ffmpeg", expect.arrayContaining([
        "-i", "/tmp/input.mkv",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-y", "/tmp/output.mp4",
      ]));
    });

    it("respects custom maxHeight and preset options", async () => {
      const proc = makeFakeProcess("");
      spawnMock.mockReturnValueOnce(proc);

      const { transcodeToProxy } = await import("~~/server/services/video/ffmpeg");
      queueMicrotask(() => proc._emit());

      await transcodeToProxy({
        inputPath: "/tmp/input.mkv",
        outputPath: "/tmp/output.mp4",
        maxHeight: 720,
        preset: "ultrafast",
        crf: 28,
        audioBitrate: "96k",
      });

      const args = spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain("ultrafast");
      expect(args).toContain("28");
      expect(args).toContain("96k");
      expect(args.some((a: string) => a.includes("720"))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // extractClip
  // -----------------------------------------------------------------------
  describe("extractClip", () => {
    it("throws when endTime <= startTime", async () => {
      const { extractClip } = await import("~~/server/services/video/ffmpeg");

      await expect(
        extractClip({ inputPath: "/in", outputPath: "/out", startTime: 10, endTime: 5 }),
      ).rejects.toThrow("End time must be after start time");
    });

    it("uses stream copy first for fast extraction", async () => {
      const proc = makeFakeProcess("");
      spawnMock.mockReturnValueOnce(proc);

      const { extractClip } = await import("~~/server/services/video/ffmpeg");
      queueMicrotask(() => proc._emit());

      await extractClip({
        inputPath: "/tmp/source.mp4",
        outputPath: "/tmp/clip.mp4",
        startTime: 10,
        endTime: 30,
      });

      expect(spawnMock).toHaveBeenCalledWith("ffmpeg", expect.arrayContaining([
        "-ss", "10",
        "-i", "/tmp/source.mp4",
        "-t", "20",
        "-c", "copy",
        "-movflags", "+faststart",
        "-y", "/tmp/clip.mp4",
      ]));
    });

    it("falls back to re-encode when stream copy fails", async () => {
      // First call fails (stream copy)
      const failProc = makeFakeProcess(undefined, "codec not supported", 1);
      spawnMock.mockReturnValueOnce(failProc);

      // Second call succeeds (re-encode)
      const successProc = makeFakeProcess("");
      spawnMock.mockReturnValueOnce(successProc);

      const { extractClip } = await import("~~/server/services/video/ffmpeg");

      queueMicrotask(() => {
        failProc._emit();
        queueMicrotask(() => successProc._emit());
      });

      await extractClip({
        inputPath: "/tmp/source.mkv",
        outputPath: "/tmp/clip.mp4",
        startTime: 0,
        endTime: 10,
      });

      // Should have been called twice: once for copy, once for re-encode
      expect(spawnMock).toHaveBeenCalledTimes(2);

      const secondCallArgs = spawnMock.mock.calls[1][1] as string[];
      expect(secondCallArgs).toContain("libx264");
      expect(secondCallArgs).toContain("aac");
    });
  });
});
