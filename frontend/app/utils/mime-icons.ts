const mimeIconMap: Record<string, string> = {
  "inode/directory": "i-lucide-folder",
  "application/pdf": "i-lucide-file-text",
  "application/zip": "i-lucide-file-archive",
  "application/x-zip-compressed": "i-lucide-file-archive",
  "application/gzip": "i-lucide-file-archive",
  "application/x-tar": "i-lucide-file-archive",
  "application/x-rar-compressed": "i-lucide-file-archive",
  "application/json": "i-lucide-file-json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "i-lucide-file-text",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "i-lucide-file-spreadsheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "i-lucide-file-image",
  "application/msword": "i-lucide-file-text",
  "application/vnd.ms-excel": "i-lucide-file-spreadsheet",
  "application/vnd.ms-powerpoint": "i-lucide-file-image",
};

const prefixIconMap: [string, string][] = [
  ["image/", "i-lucide-image"],
  ["video/", "i-lucide-video"],
  ["audio/", "i-lucide-music"],
  ["text/", "i-lucide-file-code"],
];

export function getMimeIcon(mimeType: string): string {
  if (mimeIconMap[mimeType]) {
    return mimeIconMap[mimeType];
  }
  for (const [prefix, icon] of prefixIconMap) {
    if (mimeType.startsWith(prefix)) {
      return icon;
    }
  }
  return "i-lucide-file";
}

const extensionMimeMap: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  rar: "application/x-rar-compressed",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  ts: "text/typescript",
  yaml: "text/yaml",
  yml: "text/yaml",
  sql: "text/plain",
  csv: "text/csv",
};

export function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return extensionMimeMap[ext] ?? "application/octet-stream";
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
