import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createStorageService } from "~~/server/utils/storage";

const {
  s3ClientCtorMock,
  s3WriteMock,
  s3ExistsMock,
  s3SizeMock,
  s3ListMock,
  s3DeleteMock,
  s3UnlinkMock,
  s3FileBytesMock,
  s3FileStreamMock,
  s3CallLog,
  s3Store,
} = vi.hoisted(() => ({
  s3ClientCtorMock: vi.fn(),
  s3WriteMock: vi.fn(),
  s3ExistsMock: vi.fn(),
  s3SizeMock: vi.fn(),
  s3ListMock: vi.fn(),
  s3DeleteMock: vi.fn(),
  s3UnlinkMock: vi.fn(),
  s3FileBytesMock: vi.fn(),
  s3FileStreamMock: vi.fn(),
  s3CallLog: [] as Array<{ method: string; payload: Record<string, unknown> }>,
  s3Store: new Map<string, Buffer>(),
}));

function resetS3Store(): void {
  s3Store.clear();
  s3CallLog.splice(0, s3CallLog.length);
}

function addS3Call(method: string, payload: Record<string, unknown> = {}): void {
  s3CallLog.push({ method, payload });
}

async function toBuffer(data: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof Response) return Buffer.from(await data.arrayBuffer());
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  if (typeof data === "string") return Buffer.from(data);
  if (data && typeof (data as ReadableStream).getReader === "function") {
    return await streamToBuffer(data as ReadableStream<Uint8Array>);
  }
  throw new TypeError("Unsupported body for S3 write");
}

function streamFromBuffer(buffer: Buffer): ReadableStream {
  return new Response(buffer).body as ReadableStream;
}

function createUploadStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function installMockBunS3Client(): void {
  const existingBun = (globalThis as any).Bun ?? {};

  const file = (path: string) => ({
    stream: () => streamFromBuffer(readFileSync(path)),
    slice: (start: number, end?: number) => ({
      stream: () => streamFromBuffer(readFileSync(path).subarray(start, end)),
    }),
    bytes: async () => new Uint8Array(readFileSync(path)),
    exists: async () => existsSync(path),
    get size() {
      return existsSync(path) ? statSync(path).size : 0;
    },
  });

  const write = async (path: string, data: unknown): Promise<number> => {
    await mkdir(dirname(path), { recursive: true });
    const buffer = await toBuffer(data);
    await writeFile(path, buffer);
    return buffer.byteLength;
  };

  class MockS3Client {
    constructor(config: unknown) {
      s3ClientCtorMock(config);
    }

    async write(key: string, body: unknown): Promise<number> {
      addS3Call("write", { key });
      if (s3WriteMock.getMockImplementation()) {
        return await s3WriteMock(key, body);
      }
      const buffer = await toBuffer(body);
      s3Store.set(key, buffer);
      return buffer.byteLength;
    }

    async exists(key: string): Promise<boolean> {
      addS3Call("exists", { key });
      if (s3ExistsMock.getMockImplementation()) {
        return await s3ExistsMock(key);
      }
      return s3Store.has(key);
    }

    async size(key: string): Promise<number> {
      addS3Call("size", { key });
      if (s3SizeMock.getMockImplementation()) {
        return await s3SizeMock(key);
      }
      return s3Store.get(key)?.byteLength ?? 0;
    }

    async list(options: { prefix?: string }): Promise<Array<{ key: string }>> {
      addS3Call("list", { ...options });
      if (s3ListMock.getMockImplementation()) {
        return await s3ListMock(options);
      }
      const prefix = options.prefix || "";
      return [...s3Store.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key }));
    }

    async delete(key: string): Promise<void> {
      addS3Call("delete", { key });
      if (s3DeleteMock.getMockImplementation()) {
        return await s3DeleteMock(key);
      }
      s3Store.delete(key);
    }

    async unlink(key: string): Promise<void> {
      addS3Call("unlink", { key });
      if (s3UnlinkMock.getMockImplementation()) {
        return await s3UnlinkMock(key);
      }
      s3Store.delete(key);
    }

    file(key: string): {
      bytes: () => Promise<Uint8Array>;
      stream: () => ReadableStream;
      slice: (start: number, end?: number) => { stream: () => ReadableStream };
    } {
      return {
        bytes: async () => {
          addS3Call("file.bytes", { key });
          if (s3FileBytesMock.getMockImplementation()) {
            return await s3FileBytesMock(key);
          }
          return new Uint8Array(s3Store.get(key) ?? Buffer.alloc(0));
        },
        stream: () => {
          addS3Call("file.stream", { key });
          if (s3FileStreamMock.getMockImplementation()) {
            return s3FileStreamMock(key);
          }
          return streamFromBuffer(s3Store.get(key) ?? Buffer.alloc(0));
        },
        slice: (start: number, end?: number) => ({
          stream: () => {
            addS3Call("file.slice.stream", { key, start, end });
            const source = s3Store.get(key) ?? Buffer.alloc(0);
            return streamFromBuffer(source.subarray(start, end));
          },
        }),
      };
    }
  }

  vi.stubGlobal("Bun", {
    ...existingBun,
    file,
    write,
    S3Client: MockS3Client,
  });
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function mockCreateError() {
  vi.stubGlobal("createError", (details: { statusCode?: number; statusMessage?: string }) => {
    const error = new Error(details.statusMessage || "Storage error") as Error & {
      statusCode?: number;
      statusMessage?: string;
    };
    error.statusCode = details.statusCode;
    error.statusMessage = details.statusMessage;
    return error;
  });
}

describe("storage service", () => {
  beforeEach(() => {
    s3ClientCtorMock.mockReset();
    s3WriteMock.mockReset();
    s3ExistsMock.mockReset();
    s3SizeMock.mockReset();
    s3ListMock.mockReset();
    s3DeleteMock.mockReset();
    s3UnlinkMock.mockReset();
    s3FileBytesMock.mockReset();
    s3FileStreamMock.mockReset();
    resetS3Store();
    installMockBunS3Client();
    mockCreateError();
  });

  it("stores, reads, ranges, and deletes file content on local storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "alcoves-local-storage-"));
    const storagePath = join(root, "files");
    const avatarStoragePath = join(root, "avatars");
    const storageCachePath = join(root, "cache");

    const runtimeConfig = {
      storageDriver: "local",
      storagePath,
      avatarStoragePath,
      storageCachePath,
      s3Storage: {
        prefixes: {
          files: "files",
          avatars: "avatars",
          cache: "cache",
        },
      },
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

  it("uses bun s3 backend for file operations", async () => {
    const runtimeConfig = {
      storageDriver: "s3",
      storagePath: "/unused/local/files",
      avatarStoragePath: "/unused/local/avatars",
      storageCachePath: "/unused/local/cache",
      s3Storage: {
        bucket: "alcoves-test-bucket",
        region: "us-east-1",
        endpoint: "http://localhost:9000",
        accessKeyId: "test-key",
        secretAccessKey: "test-secret",
        forcePathStyle: true,
        prefixes: {
          files: "f",
          avatars: "a",
          cache: "c",
        },
      },
    };

    const storage = createStorageService(runtimeConfig);
    await storage.ensureReady();

    await storage.storeFile("lib-1", "file-1", Buffer.from("value"));
    const streamedSize = await storage.storeFileStream(
      "lib-1",
      "file-2",
      createUploadStream("stream"),
    );
    expect(streamedSize).toBe(6);

    expect(await storage.fileExists("lib-1", "file-1")).toBe(true);
    expect((await storage.fileStat("lib-1", "file-1")).size).toBe(5);
    expect((await storage.readFileBuffer("lib-1", "file-1")).toString("utf8")).toBe("value");

    const sliceStream = await storage.openFileReadStream("lib-1", "file-1", { start: 1, end: 3 });
    expect((await streamToBuffer(sliceStream)).toString("utf8")).toBe("alu");

    await storage.deleteFile("lib-1", "file-1");

    expect(s3ClientCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "alcoves-test-bucket",
        region: "us-east-1",
        endpoint: "http://localhost:9000",
        accessKeyId: "test-key",
        secretAccessKey: "test-secret",
        virtualHostedStyle: false,
      }),
    );

    expect(s3CallLog).toContainEqual(
      expect.objectContaining({
        method: "write",
        payload: expect.objectContaining({ key: "f/lib-1/file-1/blob" }),
      }),
    );
    expect(s3CallLog).toContainEqual(
      expect.objectContaining({
        method: "list",
        payload: expect.objectContaining({ prefix: "f/lib-1/file-1/" }),
      }),
    );
    expect(s3CallLog).toContainEqual(
      expect.objectContaining({
        method: "delete",
        payload: expect.objectContaining({ key: "f/lib-1/file-1/blob" }),
      }),
    );
  });

  it("returns false from exists when s3 responds with not found", async () => {
    const runtimeConfig = {
      storageDriver: "s3",
      storagePath: "/unused/local/files",
      avatarStoragePath: "/unused/local/avatars",
      storageCachePath: "/unused/local/cache",
      s3Storage: {
        bucket: "alcoves-test-bucket",
        region: "us-east-1",
        prefixes: {
          files: "files",
          avatars: "avatars",
          cache: "cache",
        },
      },
    };

    s3ExistsMock.mockImplementation(async () => {
      const error = new Error("missing") as Error & { name: string };
      error.name = "NotFound";
      throw error;
    });

    const storage = createStorageService(runtimeConfig);
    expect(await storage.fileExists("lib-missing", "file-missing")).toBe(false);
  });
});
