import { constants } from "node:fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type StorageScope = "files" | "avatars" | "cache";

export type StorageByteRange = {
  start: number;
  end?: number;
};

type StoragePrefixConfig = Partial<Record<StorageScope, string>>;

type S3StorageRuntimeConfig = {
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  prefixes?: StoragePrefixConfig;
};

export type StorageRuntimeConfig = {
  storageDriver?: string;
  storagePath: string;
  avatarStoragePath: string;
  storageCachePath: string;
  s3Storage?: S3StorageRuntimeConfig;
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
    const writer = Bun.file(filePath).writer();

    let size = 0;
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        size += value.byteLength;
        await writer.write(value);
      }
      await writer.end();
    } catch (error) {
      await writer.end();
      throw error;
    }

    return size;
  }

  async openReadStream(
    scope: StorageScope,
    key: string,
    range?: StorageByteRange,
  ): Promise<ReadableStream<Uint8Array>> {
    const filePath = this.resolvePath(scope, key);
    if (!range) return Bun.file(filePath).stream();

    return Bun.file(filePath)
      .slice(range.start, range.end !== undefined ? range.end + 1 : undefined)
      .stream();
  }

  async readBuffer(scope: StorageScope, key: string): Promise<Buffer> {
    return await readFile(this.resolvePath(scope, key));
  }

  async exists(scope: StorageScope, key: string): Promise<boolean> {
    try {
      await access(this.resolvePath(scope, key), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async stat(scope: StorageScope, key: string): Promise<StorageStat> {
    const metadata = await stat(this.resolvePath(scope, key));
    return { size: metadata.size };
  }

  async deletePrefix(scope: StorageScope, keyPrefix: string): Promise<void> {
    await rm(this.resolvePath(scope, keyPrefix), { recursive: true, force: true });
  }

  private resolvePath(scope: StorageScope, key: string): string {
    return join(this.roots[scope], key);
  }
}

type S3StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  prefixes: Record<StorageScope, string>;
};

class S3StorageDriver implements StorageDriver {
  private client: any | null = null;

  constructor(private readonly config: S3StorageConfig) {}

  async ensureReady(): Promise<void> {
    this.validateConfig();
    this.getClient();
  }

  async putBuffer(scope: StorageScope, key: string, data: Buffer): Promise<void> {
    const client = this.getClient();
    await client.write(this.getObjectKey(scope, key), data);
  }

  async putStream(
    scope: StorageScope,
    key: string,
    stream: ReadableStream<Uint8Array>,
  ): Promise<number> {
    const client = this.getClient();
    const [uploadStream, counterStream] = stream.tee();
    const uploadPromise = client.write(this.getObjectKey(scope, key), uploadStream);
    let size = 0;
    const reader = counterStream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
    }
    await uploadPromise;
    return size;
  }

  async openReadStream(
    scope: StorageScope,
    key: string,
    range?: StorageByteRange,
  ): Promise<ReadableStream<Uint8Array>> {
    const client = this.getClient();
    const file = client.file(this.getObjectKey(scope, key));

    const target =
      range && range.end !== undefined
        ? file.slice(range.start, range.end + 1)
        : range
          ? file.slice(range.start)
          : file;

    return target.stream();
  }

  async readBuffer(scope: StorageScope, key: string): Promise<Buffer> {
    const client = this.getClient();
    const bytes = await client.file(this.getObjectKey(scope, key)).bytes();
    return Buffer.from(bytes);
  }

  async exists(scope: StorageScope, key: string): Promise<boolean> {
    const client = this.getClient();
    try {
      return await client.exists(this.getObjectKey(scope, key));
    } catch (error: any) {
      if (
        error?.$metadata?.httpStatusCode === 404 ||
        error?.statusCode === 404 ||
        error?.name === "NotFound" ||
        error?.name === "NoSuchKey" ||
        error?.code === "NoSuchKey"
      ) {
        return false;
      }
      throw error;
    }
  }

  async stat(scope: StorageScope, key: string): Promise<StorageStat> {
    const client = this.getClient();
    const size = await client.size(this.getObjectKey(scope, key));
    return { size: Number(size) || 0 };
  }

  async deletePrefix(scope: StorageScope, keyPrefix: string): Promise<void> {
    const client = this.getClient();
    const prefix = this.getPrefix(scope, keyPrefix);

    const listed = await client.list({ prefix });
    const objectKeys = this.extractObjectKeys(listed);
    if (objectKeys.length === 0) return;

    for (const objectKey of objectKeys) {
      try {
        await client.delete(objectKey);
      } catch (error: any) {
        // Bun also exposes unlink with equivalent behavior.
        if (typeof client.unlink === "function") {
          await client.unlink(objectKey);
          continue;
        }
        if (
          error?.$metadata?.httpStatusCode === 404 ||
          error?.statusCode === 404 ||
          error?.name === "NotFound" ||
          error?.name === "NoSuchKey" ||
          error?.code === "NoSuchKey"
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  private validateConfig(): void {
    if (!this.config.bucket) {
      throw createError({
        statusCode: 500,
        statusMessage: "ALCOVES_S3_BUCKET is required when ALCOVES_STORAGE_DRIVER=s3",
      });
    }
    if (!this.config.region) {
      throw createError({
        statusCode: 500,
        statusMessage: "ALCOVES_S3_REGION is required when ALCOVES_STORAGE_DRIVER=s3",
      });
    }
  }

  private getClient(): any {
    if (this.client) return this.client;

    this.validateConfig();
    const BunRuntime = (globalThis as any).Bun;
    if (!BunRuntime?.S3Client) {
      throw createError({
        statusCode: 500,
        statusMessage: "S3 storage driver requires Bun runtime with Bun.S3Client support",
      });
    }

    const clientOptions: Record<string, unknown> = {
      bucket: this.config.bucket,
      region: this.config.region,
    };

    if (this.config.endpoint) {
      clientOptions.endpoint = this.config.endpoint;
    }
    if (this.config.accessKeyId) {
      clientOptions.accessKeyId = this.config.accessKeyId;
    }
    if (this.config.secretAccessKey) {
      clientOptions.secretAccessKey = this.config.secretAccessKey;
    }
    if (this.config.forcePathStyle) {
      clientOptions.virtualHostedStyle = false;
    }

    this.client = new BunRuntime.S3Client(clientOptions);
    return this.client;
  }

  private getObjectKey(scope: StorageScope, key: string): string {
    const prefix = this.normalizePathSegment(this.config.prefixes[scope]);
    const normalizedKey = key.replace(/^\/+/, "");
    return [prefix, normalizedKey].filter(Boolean).join("/");
  }

  private getPrefix(scope: StorageScope, keyPrefix: string): string {
    const objectKey = this.getObjectKey(scope, keyPrefix.replace(/\/+$/, ""));
    return objectKey ? `${objectKey}/` : "";
  }

  private normalizePathSegment(segment: string): string {
    return segment.replace(/^\/+|\/+$/g, "");
  }

  private extractObjectKeys(listResponse: any): string[] {
    if (!listResponse) return [];

    const entries = Array.isArray(listResponse)
      ? listResponse
      : Array.isArray(listResponse.contents)
        ? listResponse.contents
        : Array.isArray(listResponse.objects)
          ? listResponse.objects
          : [];

    return entries
      .map((entry: any) => {
        if (typeof entry === "string") return entry;
        return entry?.key || entry?.Key || null;
      })
      .filter((item: string | null): item is string => Boolean(item));
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

  async storeCacheBuffer(cacheKey: string, buffer: Buffer): Promise<void> {
    await this.driver.putBuffer("cache", cacheKey, buffer);
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

function createStorageDriver(config: StorageRuntimeConfig): StorageDriver {
  const driverName = String(config.storageDriver || "local").toLowerCase();

  if (driverName === "s3") {
    const s3Config = config.s3Storage;
    return new S3StorageDriver({
      bucket: s3Config?.bucket || "",
      region: s3Config?.region || "",
      endpoint: s3Config?.endpoint || "",
      accessKeyId: s3Config?.accessKeyId || "",
      secretAccessKey: s3Config?.secretAccessKey || "",
      forcePathStyle: Boolean(s3Config?.forcePathStyle),
      prefixes: {
        files: s3Config?.prefixes?.files || "files",
        avatars: s3Config?.prefixes?.avatars || "avatars",
        cache: s3Config?.prefixes?.cache || "cache",
      },
    });
  }

  return new LocalStorageDriver({
    files: resolve(config.storagePath),
    avatars: resolve(config.avatarStoragePath),
    cache: resolve(config.storageCachePath),
  });
}

export function createStorageService(config: StorageRuntimeConfig): StorageService {
  return new StorageService(createStorageDriver(config));
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
