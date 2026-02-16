import { describe, it, expect } from "vitest";
import {
  getMimeIcon,
  getMimeTypeFromFilename,
  formatFileSize,
  formatDate,
} from "~/utils/mime-icons";

describe("getMimeIcon", () => {
  it("returns PDF icon for PDF mime type", () => {
    expect(getMimeIcon("application/pdf")).toBe("i-lucide-file-text");
  });

  it("returns archive icon for ZIP mime types", () => {
    expect(getMimeIcon("application/zip")).toBe("i-lucide-file-archive");
    expect(getMimeIcon("application/x-zip-compressed")).toBe("i-lucide-file-archive");
    expect(getMimeIcon("application/gzip")).toBe("i-lucide-file-archive");
  });

  it("returns JSON icon for JSON mime type", () => {
    expect(getMimeIcon("application/json")).toBe("i-lucide-file-json");
  });

  it("returns image icon for image/* mime types", () => {
    expect(getMimeIcon("image/jpeg")).toBe("i-lucide-image");
    expect(getMimeIcon("image/png")).toBe("i-lucide-image");
    expect(getMimeIcon("image/gif")).toBe("i-lucide-image");
  });

  it("returns video icon for video/* mime types", () => {
    expect(getMimeIcon("video/mp4")).toBe("i-lucide-video");
    expect(getMimeIcon("video/webm")).toBe("i-lucide-video");
  });

  it("returns audio icon for audio/* mime types", () => {
    expect(getMimeIcon("audio/mpeg")).toBe("i-lucide-music");
    expect(getMimeIcon("audio/wav")).toBe("i-lucide-music");
  });

  it("returns code icon for text/* mime types", () => {
    expect(getMimeIcon("text/plain")).toBe("i-lucide-file-code");
    expect(getMimeIcon("text/html")).toBe("i-lucide-file-code");
  });

  it("returns default file icon for unknown mime types", () => {
    expect(getMimeIcon("application/unknown")).toBe("i-lucide-file");
    expect(getMimeIcon("unknown/type")).toBe("i-lucide-file");
  });
});

describe("getMimeTypeFromFilename", () => {
  it("returns correct mime type for common file extensions", () => {
    expect(getMimeTypeFromFilename("document.pdf")).toBe("application/pdf");
    expect(getMimeTypeFromFilename("image.jpg")).toBe("image/jpeg");
    expect(getMimeTypeFromFilename("image.jpeg")).toBe("image/jpeg");
    expect(getMimeTypeFromFilename("image.png")).toBe("image/png");
    expect(getMimeTypeFromFilename("video.mp4")).toBe("video/mp4");
    expect(getMimeTypeFromFilename("audio.mp3")).toBe("audio/mpeg");
    expect(getMimeTypeFromFilename("archive.zip")).toBe("application/zip");
    expect(getMimeTypeFromFilename("data.json")).toBe("application/json");
    expect(getMimeTypeFromFilename("text.txt")).toBe("text/plain");
  });

  it("handles case-insensitive extensions", () => {
    expect(getMimeTypeFromFilename("file.PDF")).toBe("application/pdf");
    expect(getMimeTypeFromFilename("file.PNG")).toBe("image/png");
    expect(getMimeTypeFromFilename("file.MP4")).toBe("video/mp4");
  });

  it("returns default mime type for unknown extensions", () => {
    expect(getMimeTypeFromFilename("file.xyz")).toBe("application/octet-stream");
    expect(getMimeTypeFromFilename("file.unknown")).toBe("application/octet-stream");
  });

  it("handles files without extensions", () => {
    expect(getMimeTypeFromFilename("README")).toBe("application/octet-stream");
    expect(getMimeTypeFromFilename("Makefile")).toBe("application/octet-stream");
  });

  it("handles files with multiple dots", () => {
    expect(getMimeTypeFromFilename("my.file.name.pdf")).toBe("application/pdf");
    expect(getMimeTypeFromFilename("archive.tar.gz")).toBe("application/gzip");
  });
});

describe("formatFileSize", () => {
  it("formats zero bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(10240)).toBe("10 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1048576)).toBe("1 MB");
    expect(formatFileSize(1572864)).toBe("1.5 MB");
    expect(formatFileSize(10485760)).toBe("10 MB");
  });

  it("formats gigabytes", () => {
    expect(formatFileSize(1073741824)).toBe("1 GB");
    expect(formatFileSize(1610612736)).toBe("1.5 GB");
  });

  it("formats terabytes", () => {
    expect(formatFileSize(1099511627776)).toBe("1 TB");
    expect(formatFileSize(1649267441664)).toBe("1.5 TB");
  });
});

describe("formatDate", () => {
  it("formats date strings", () => {
    const result = formatDate("2024-01-15T10:30:00Z");
    expect(result).toMatch(/Jan 1[45], 2024/); // Account for timezone differences
  });

  it("formats ISO date strings", () => {
    const result = formatDate("2024-12-25T00:00:00Z");
    expect(result).toMatch(/Dec 2[45], 2024/); // Account for timezone differences
  });

  it("handles different date formats", () => {
    const result = formatDate("2024-06-01");
    expect(result).toContain("2024");
    expect(result).toMatch(/May 31|Jun 1/); // Account for timezone differences
  });
});
