import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createStorageService } from "~~/server/utils/storage";

const { s3SendMock, s3ClientCtorMock } = vi.hoisted(() => ({
  s3SendMock: vi.fn(),
  s3ClientCtorMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = s3SendMock;

    constructor(config: unknown) {
      s3ClientCtorMock(config);
    }
  }

  class PutObjectCommand {
    constructor(public readonly input: unknown) {}
  }

  class GetObjectCommand {
    constructor(public readonly input: unknown) {}
  }

  class HeadObjectCommand {
    constructor(public readonly input: unknown) {}
  }

  class ListObjectsV2Command {
    constructor(public readonly input: unknown) {}
  }

  class DeleteObjectsCommand {
    constructor(public readonly input: unknown) {}
  }

  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    DeleteObjectsCommand,
  };
});

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
    s3SendMock.mockReset();
    s3ClientCtorMock.mockReset();
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

  it("uses s3 backend commands for file operations", async () => {
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

    s3SendMock.mockImplementation(async (command: { constructor: { name: string }; input: any }) => {
      switch (command.constructor.name) {
        case "PutObjectCommand": {
          const body = command.input?.Body;
          if (body && typeof body?.on === "function") {
            await streamToBuffer(body as Readable);
          }
          return {};
        }
        case "HeadObjectCommand":
          return { ContentLength: 5 };
        case "GetObjectCommand":
          return { Body: new Uint8Array(Buffer.from("hello")) };
        case "ListObjectsV2Command":
          return {
            Contents: [{ Key: "f/lib-1/file-1/blob" }, { Key: "f/lib-1/file-1/metadata.json" }],
            IsTruncated: false,
          };
        case "DeleteObjectsCommand":
          return {};
        default:
          return {};
      }
    });

    const storage = createStorageService(runtimeConfig);
    await storage.ensureReady();

    await storage.storeFile("lib-1", "file-1", Buffer.from("value"));
    const streamedSize = await storage.storeFileStream("lib-1", "file-2", Readable.from("stream"));
    expect(streamedSize).toBe(6);

    expect(await storage.fileExists("lib-1", "file-1")).toBe(true);
    expect((await storage.fileStat("lib-1", "file-1")).size).toBe(5);
    expect((await storage.readFileBuffer("lib-1", "file-1")).toString("utf8")).toBe("hello");

    await storage.deleteFile("lib-1", "file-1");

    const commandCalls = s3SendMock.mock.calls.map(([command]) => ({
      name: command.constructor.name,
      input: command.input as Record<string, unknown>,
    }));

    expect(s3ClientCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "us-east-1",
        endpoint: "http://localhost:9000",
        forcePathStyle: true,
      }),
    );
    expect(commandCalls).toContainEqual(
      expect.objectContaining({
        name: "PutObjectCommand",
        input: expect.objectContaining({
          Bucket: "alcoves-test-bucket",
          Key: "f/lib-1/file-1/blob",
        }),
      }),
    );
    expect(commandCalls).toContainEqual(
      expect.objectContaining({
        name: "ListObjectsV2Command",
        input: expect.objectContaining({
          Bucket: "alcoves-test-bucket",
          Prefix: "f/lib-1/file-1/",
        }),
      }),
    );
    expect(commandCalls).toContainEqual(
      expect.objectContaining({
        name: "DeleteObjectsCommand",
        input: expect.objectContaining({
          Bucket: "alcoves-test-bucket",
        }),
      }),
    );
  });

  it("returns false from exists when s3 head responds with not found", async () => {
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

    s3SendMock.mockImplementation(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "HeadObjectCommand") {
        const error = new Error("not found") as Error & { name: string };
        error.name = "NotFound";
        throw error;
      }
      return {};
    });

    const storage = createStorageService(runtimeConfig);
    expect(await storage.fileExists("lib-missing", "file-missing")).toBe(false);
  });
});
