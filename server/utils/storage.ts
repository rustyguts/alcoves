import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

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
    await Bun.write(this.resolvePath(scope, key), data);
  }

  async putStream(
    scope: StorageScope,
    key: string,
    stream: ReadableStream<Uint8Array>,
  ): Promise<number> {
    return Bun.write(this.resolvePath(scope, key), new Response(stream));
  }

  async openReadStream(
    scope: StorageScope,
    key: string,
    range?: StorageByteRange,
  ): Promise<ReadableStream<Uint8Array>> {
    const file = Bun.file(this.resolvePath(scope, key));
    if (!range) return file.stream();

    return file.slice(range.start, range.end !== undefined ? range.end + 1 : undefined).stream();
  }

  async readBuffer(scope: StorageScope, key: string): Promise<Buffer> {
    return Buffer.from(await Bun.file(this.resolvePath(scope, key)).bytes());
  }

  async exists(scope: StorageScope, key: string): Promise<boolean> {
    return Bun.file(this.resolvePath(scope, key)).exists();
  }

  async stat(scope: StorageScope, key: string): Promise<StorageStat> {
    return { size: Bun.file(this.resolvePath(scope, key)).size };
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
  private client: Bun.S3Client | null = null;

  constructor(private readonly config: S3StorageConfig) {}

  async ensureReady(): Promise<void> {
    this.validateConfig();
    this.getClient();
  }

  async putBuffer(scope: StorageScope, key: string, data: Buffer): Promise<void> {
    await this.getClient().write(this.getObjectKey(scope, key), data);
  }

  async putStream(
    scope: StorageScope,
    key: string,
    stream: ReadableStream<Uint8Array>,
  ): Promise<number> {
    return this.getClient().write(this.getObjectKey(scope, key), new Response(stream));
  }

  async openReadStream(
    scope: StorageScope,
    key: string,
    range?: StorageByteRange,
  ): Promise<ReadableStream<Uint8Array>> {
    const file = this.getClient().file(this.getObjectKey(scope, key));

    const target =
      range && range.end !== undefined
        ? file.slice(range.start, range.end + 1)
        : range
          ? file.slice(range.start)
          : file;

    return target.stream();
  }

  async readBuffer(scope: StorageScope, key: string): Promise<Buffer> {
    const bytes = await this.getClient().file(this.getObjectKey(scope, key)).bytes();
    return Buffer.from(bytes);
  }

  async exists(scope: StorageScope, key: string): Promise<boolean> {
    try {
      return await this.getClient().exists(this.getObjectKey(scope, key));
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
    const size = await this.getClient().size(this.getObjectKey(scope, key));
    return { size: Number(size) || 0 };
  }

  async deletePrefix(scope: StorageScope, keyPrefix: string): Promise<void> {
    const client = this.getClient();
    const prefix = this.getPrefix(scope, keyPrefix);

    const listed = await client.list({ prefix });
    const objectKeys = this.extractObjectKeys(listed);
    if (objectKeys.length === 0) return;

    await Promise.all(
      objectKeys.map((objectKey) =>
        client.delete(objectKey).catch((error: any) => {
          if (
            error?.$metadata?.httpStatusCode === 404 ||
            error?.statusCode === 404 ||
            error?.name === "NotFound" ||
            error?.name === "NoSuchKey" ||
            error?.code === "NoSuchKey"
          ) {
            return;
          }
          throw error;
        }),
      ),
    );
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

  private getClient(): Bun.S3Client {
    if (this.client) return this.client;

    this.validateConfig();

    this.client = new Bun.S3Client({
      bucket: this.config.bucket,
      region: this.config.region,
      ...(this.config.endpoint && { endpoint: this.config.endpoint }),
      ...(this.config.accessKeyId && { accessKeyId: this.config.accessKeyId }),
      ...(this.config.secretAccessKey && { secretAccessKey: this.config.secretAccessKey }),
      ...(this.config.forcePathStyle && { virtualHostedStyle: false }),
    });

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

  async readCacheBuffer(cacheKey: string): Promise<Buffer> {
    return await this.driver.readBuffer("cache", cacheKey);
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
