import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageService } from "~~/server/utils/storage";

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

describe("storage service", () => {
  it("stores, reads, ranges, and deletes file content on local storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "alcoves-local-storage-"));
    const storagePath = join(root, "files");
    const avatarStoragePath = join(root, "avatars");
    const storageCachePath = join(root, "cache");

    const runtimeConfig = {
      storagePath,
      avatarStoragePath,
      storageCachePath,
    };

    try {
      const storage = createStorageService(runtimeConfig);
      await storage.ensureReady();

      await storage.storeFile("lib-a", "file-a", Buffer.from("hello world"));
      expect(await storage.fileExists("lib-a", "file-a")).toBe(true);
      expect((await storage.fileStat("lib-a", "file-a")).size).toBe(11);
      expect((await storage.readFileBuffer("lib-a", "file-a")).toString("utf8")).toBe(
        "hello world",
      );

      const rangeStream = await storage.openFileReadStream("lib-a", "file-a", {
        start: 6,
        end: 10,
      });
      expect((await streamToBuffer(rangeStream)).toString("utf8")).toBe("world");

      await storage.storeAvatar("user-a", Buffer.from("avatar"));
      expect(await storage.avatarExists("user-a")).toBe(true);

      await storage.storeCacheBuffer("file/lib-a/file-a/thumb.webp", Buffer.from("cache-hit"));
      expect(await storage.cacheExists("file/lib-a/file-a/thumb.webp")).toBe(true);
      const cacheStream = await storage.openCacheReadStream("file/lib-a/file-a/thumb.webp");
      expect((await streamToBuffer(cacheStream)).toString("utf8")).toBe("cache-hit");

      await storage.deleteFile("lib-a", "file-a");
      expect(await storage.fileExists("lib-a", "file-a")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stores a file via stream and returns the written size", async () => {
    const root = await mkdtemp(join(tmpdir(), "alcoves-local-storage-"));
    const storagePath = join(root, "files");
    const avatarStoragePath = join(root, "avatars");
    const storageCachePath = join(root, "cache");

    const runtimeConfig = {
      storagePath,
      avatarStoragePath,
      storageCachePath,
    };

    try {
      const storage = createStorageService(runtimeConfig);
      await storage.ensureReady();

      const content = "streamed content";
      const bytes = new TextEncoder().encode(content);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });

      const size = await storage.storeFileStream("lib-1", "file-1", stream);
      expect(size).toBe(bytes.byteLength);
      expect((await storage.readFileBuffer("lib-1", "file-1")).toString("utf8")).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
