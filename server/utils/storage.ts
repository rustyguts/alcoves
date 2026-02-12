import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type StorageScope = "files" | "avatars" | "cache";

export type StorageByteRange = {
  start: number;
  end?: number;
};

export type StorageRuntimeConfig = {
  storagePath: string;
  avatarStoragePath: string;
  storageCachePath: string;
};

type StorageStat = {
  size: number;
};

interface StorageDriver {
  ensureReady(): Promise<void>;
  putBuffer(scope: StorageScope, key: string, data: Buffer): Promise<void>;
  putStream(scope: StorageScope, key: string, stream: ReadableStream<Uint8Array>): Promise<number>;
  openReadStream(
    scope: StorageScope,
    key: string,
    range?: StorageByteRange,
  ): Promise<ReadableStream<Uint8Array>>;
  readBuffer(scope: StorageScope, key: string): Promise<Buffer>;
  exists(scope: StorageScope, key: string): Promise<boolean>;
  stat(scope: StorageScope, key: string): Promise<StorageStat>;
  deletePrefix(scope: StorageScope, keyPrefix: string): Promise<void>;
}

type LocalStorageRoots = Record<StorageScope, string>;

class LocalStorageDriver implements StorageDriver {
  constructor(private readonly roots: LocalStorageRoots) {}

  async ensureReady(): Promise<void> {
    await Promise.all(Object.values(this.roots).map((root) => mkdir(root, { recursive: true })));
  }

  async putBuffer(scope: StorageScope, key: string, data: Buffer): Promise<void> {
    const filePath = this.resolvePath(scope, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  async putStream(
    scope: StorageScope,
    key: string,
    stream: ReadableStream<Uint8Array>,
  ): Promise<number> {
    const filePath = this.resolvePath(scope, key);
    await mkdir(dirname(filePath), { recursive: true });

    const nodeReadable = Readable.fromWeb(stream as import("stream/web").ReadableStream);
    const writable = createWriteStream(filePath);
    await pipeline(nodeReadable, writable);

    return statSync(filePath).size;
  }

  async openReadStream(
    scope: StorageScope,
    key: string,
    range?: StorageByteRange,
  ): Promise<ReadableStream<Uint8Array>> {
    const filePath = this.resolvePath(scope, key);
    const opts: { start?: number; end?: number } = {};
    if (range) {
      opts.start = range.start;
      if (range.end !== undefined) opts.end = range.end;
    }
    const nodeStream = createReadStream(filePath, opts);
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  }

  async readBuffer(scope: StorageScope, key: string): Promise<Buffer> {
    return readFile(this.resolvePath(scope, key));
  }

  async exists(scope: StorageScope, key: string): Promise<boolean> {
    return existsSync(this.resolvePath(scope, key));
  }

  async stat(scope: StorageScope, key: string): Promise<StorageStat> {
    return { size: statSync(this.resolvePath(scope, key)).size };
  }

  async deletePrefix(scope: StorageScope, keyPrefix: string): Promise<void> {
    await rm(this.resolvePath(scope, keyPrefix), { recursive: true, force: true });
  }

  private resolvePath(scope: StorageScope, key: string): string {
    return join(this.roots[scope], key);
  }
}

export class StorageService {
  constructor(private readonly driver: StorageDriver) {}

  async ensureReady(): Promise<void> {
    await this.driver.ensureReady();
  }

  async storeFile(libraryId: string, fileId: string, data: Buffer): Promise<void> {
    await this.driver.putBuffer("files", this.fileBlobKey(libraryId, fileId), data);
  }

  async storeAvatar(userId: string, data: Buffer): Promise<void> {
    await this.driver.putBuffer("avatars", this.avatarBlobKey(userId), data);
  }

  async storeFileStream(
    libraryId: string,
    fileId: string,
    stream: ReadableStream<Uint8Array>,
  ): Promise<number> {
    return await this.driver.putStream("files", this.fileBlobKey(libraryId, fileId), stream);
  }

  async deleteFile(libraryId: string, fileId: string): Promise<void> {
    await this.driver.deletePrefix("files", this.filePrefix(libraryId, fileId));
  }

  async fileExists(libraryId: string, fileId: string): Promise<boolean> {
    return await this.driver.exists("files", this.fileBlobKey(libraryId, fileId));
  }

  async avatarExists(userId: string): Promise<boolean> {
    return await this.driver.exists("avatars", this.avatarBlobKey(userId));
  }

  async readFileBuffer(libraryId: string, fileId: string): Promise<Buffer> {
    return await this.driver.readBuffer("files", this.fileBlobKey(libraryId, fileId));
  }

  async readAvatarBuffer(userId: string): Promise<Buffer> {
    return await this.driver.readBuffer("avatars", this.avatarBlobKey(userId));
  }

  async fileStat(libraryId: string, fileId: string): Promise<StorageStat> {
    return await this.driver.stat("files", this.fileBlobKey(libraryId, fileId));
  }

  async openFileReadStream(
    libraryId: string,
    fileId: string,
    range?: StorageByteRange,
  ): Promise<ReadableStream<Uint8Array>> {
    return await this.driver.openReadStream("files", this.fileBlobKey(libraryId, fileId), range);
  }

  async cacheExists(cacheKey: string): Promise<boolean> {
    return await this.driver.exists("cache", cacheKey);
  }

  async openCacheReadStream(cacheKey: string): Promise<ReadableStream<Uint8Array>> {
    return await this.driver.openReadStream("cache", cacheKey);
  }

  async readCacheBuffer(cacheKey: string): Promise<Buffer> {
    return await this.driver.readBuffer("cache", cacheKey);
  }

  async storeCacheBuffer(cacheKey: string, buffer: Buffer): Promise<void> {
    await this.driver.putBuffer("cache", cacheKey, buffer);
  }

  async storeCacheStream(
    cacheKey: string,
    stream: ReadableStream<Uint8Array>,
  ): Promise<number> {
    return await this.driver.putStream("cache", cacheKey, stream);
  }

  async deleteCachePrefix(prefix: string): Promise<void> {
    await this.driver.deletePrefix("cache", prefix);
  }

  private filePrefix(libraryId: string, fileId: string): string {
    return `${libraryId}/${fileId}`;
  }

  private fileBlobKey(libraryId: string, fileId: string): string {
    return `${this.filePrefix(libraryId, fileId)}/blob`;
  }

  private avatarBlobKey(userId: string): string {
    return `${userId}/avatar.webp`;
  }
}

export function createStorageService(config: StorageRuntimeConfig): StorageService {
  return new StorageService(
    new LocalStorageDriver({
      files: resolve(config.storagePath),
      avatars: resolve(config.avatarStoragePath),
      cache: resolve(config.storageCachePath),
    }),
  );
}

export function useStorageService(): StorageService {
  return createStorageService(useRuntimeConfig() as unknown as StorageRuntimeConfig);
}

// Backward-compatible wrappers while moving callsites to class usage.
export async function storeFile(libraryId: string, fileId: string, data: Buffer): Promise<void> {
  await useStorageService().storeFile(libraryId, fileId, data);
}

export async function storeAvatar(userId: string, data: Buffer): Promise<void> {
  await useStorageService().storeAvatar(userId, data);
}

export async function storeFileStream(
  libraryId: string,
  fileId: string,
  stream: ReadableStream<Uint8Array>,
): Promise<number> {
  return await useStorageService().storeFileStream(libraryId, fileId, stream);
}

export async function deleteFileFromDisk(libraryId: string, fileId: string): Promise<void> {
  await useStorageService().deleteFile(libraryId, fileId);
}

export async function ensureStorageDir(): Promise<void> {
  await useStorageService().ensureReady();
}
