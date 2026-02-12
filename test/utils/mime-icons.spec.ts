import {
  formatDate,
  formatFileSize,
  getFileNameWithoutExtension,
  getMimeIcon,
  getMimeTypeFromFilename,
} from "~/utils/mime-icons";

describe("mime-icons utils", () => {
  describe("getMimeIcon", () => {
    it("returns exact icon mapping when mime is known", () => {
      expect(getMimeIcon("application/pdf")).toBe("i-lucide-file-text");
      expect(getMimeIcon("application/vnd.ms-excel")).toBe("i-lucide-file-spreadsheet");
    });

    it("falls back to prefix mapping for media and text types", () => {
      expect(getMimeIcon("image/jpeg")).toBe("i-lucide-image");
      expect(getMimeIcon("video/mp4")).toBe("i-lucide-video");
      expect(getMimeIcon("audio/mpeg")).toBe("i-lucide-music");
      expect(getMimeIcon("text/plain")).toBe("i-lucide-file-code");
    });

    it("returns generic icon when mime is unknown", () => {
      expect(getMimeIcon("application/x-unknown")).toBe("i-lucide-file");
    });
  });

  describe("getMimeTypeFromFilename", () => {
    it("returns known mime types by extension", () => {
      expect(getMimeTypeFromFilename("report.pdf")).toBe("application/pdf");
      expect(getMimeTypeFromFilename("photo.JPEG")).toBe("image/jpeg");
      expect(getMimeTypeFromFilename("archive.tar")).toBe("application/x-tar");
      expect(getMimeTypeFromFilename("clip.webm")).toBe("video/webm");
    });

    it("returns octet-stream for unknown or extensionless names", () => {
      expect(getMimeTypeFromFilename("README")).toBe("application/octet-stream");
      expect(getMimeTypeFromFilename("file.unknownext")).toBe("application/octet-stream");
    });
  });

  describe("getFileNameWithoutExtension", () => {
    it("removes trailing extension", () => {
      expect(getFileNameWithoutExtension("notes.txt")).toBe("notes");
      expect(getFileNameWithoutExtension("archive.tar.gz")).toBe("archive.tar");
    });

    it("keeps names without a removable extension", () => {
      expect(getFileNameWithoutExtension("noext")).toBe("noext");
      expect(getFileNameWithoutExtension(".env")).toBe(".env");
    });
  });

  describe("formatFileSize", () => {
    it("formats bytes and larger units", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(512)).toBe("512 B");
      expect(formatFileSize(1024)).toBe("1 KB");
      expect(formatFileSize(1536)).toBe("1.5 KB");
      expect(formatFileSize(1024 * 1024)).toBe("1 MB");
    });
  });

  describe("formatDate", () => {
    it("formats ISO date into US short form", () => {
      expect(formatDate("2024-01-02T12:00:00.000Z")).toBe("Jan 2, 2024");
    });
  });
});
