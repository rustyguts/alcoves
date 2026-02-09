import { constants } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PassThrough, Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

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
  putStream(scope: StorageScope, key: string, stream: Readable): Promise<number>;
  openReadStream(scope: StorageScope, key: string, range?: StorageByteRange): Promise<Readable>;
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

  async putStream(scope: StorageScope, key: string, stream: Readable): Promise<number> {
    const filePath = this.resolvePath(scope, key);
    await mkdir(dirname(filePath), { recursive: true });

    let size = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        callback(null, chunk);
      },
    });

    await pipeline(stream, counter, createWriteStream(filePath));
    return size;
  }

  async openReadStream(
    scope: StorageScope,
    key: string,
    range?: StorageByteRange,
  ): Promise<Readable> {
    const filePath = this.resolvePath(scope, key);
    if (!range) return createReadStream(filePath);

    return createReadStream(
      filePath,
      range.end !== undefined ? { start: range.start, end: range.end } : { start: range.start },
    );
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
  private sdk: any | null = null;
  private client: any | null = null;
  private clientPromise: Promise<any> | null = null;

  constructor(private readonly config: S3StorageConfig) {}

  async ensureReady(): Promise<void> {
    this.validateConfig();
    await this.getClient();
  }

  async putBuffer(scope: StorageScope, key: string, data: Buffer): Promise<void> {
    const { client, sdk } = await this.getClientWithSdk();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getObjectKey(scope, key),
        Body: data,
      }),
    );
  }

  async putStream(scope: StorageScope, key: string, stream: Readable): Promise<number> {
    const { client, sdk } = await this.getClientWithSdk();
    const passThrough = new PassThrough();

    let size = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        callback(null, chunk);
      },
    });

    const uploadPromise = client.send(
      new sdk.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getObjectKey(scope, key),
        Body: passThrough,
      }),
    );

    await pipeline(stream, counter, passThrough);
    await uploadPromise;
    return size;
  }

  async openReadStream(
    scope: StorageScope,
    key: string,
    range?: StorageByteRange,
  ): Promise<Readable> {
    const { client, sdk } = await this.getClientWithSdk();
    const rangeHeader = range ? `bytes=${range.start}-${range.end ?? ""}` : undefined;
    const response = await client.send(
      new sdk.GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getObjectKey(scope, key),
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      }),
    );

    if (!response.Body) {
      throw createError({ statusCode: 404, statusMessage: "Storage object body missing" });
    }

    return await this.toNodeReadable(response.Body);
  }

  async readBuffer(scope: StorageScope, key: string): Promise<Buffer> {
    const { client, sdk } = await this.getClientWithSdk();
    const response = await client.send(
      new sdk.GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getObjectKey(scope, key),
      }),
    );

    if (!response.Body) {
      throw createError({ statusCode: 404, statusMessage: "Storage object body missing" });
    }

    return await this.readBodyToBuffer(response.Body);
  }

  async exists(scope: StorageScope, key: string): Promise<boolean> {
    const { client, sdk } = await this.getClientWithSdk();
    try {
      await client.send(
        new sdk.HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: this.getObjectKey(scope, key),
        }),
      );
      return true;
    } catch (error: any) {
      if (
        error?.$metadata?.httpStatusCode === 404 ||
        error?.name === "NotFound" ||
        error?.name === "NoSuchKey"
      ) {
        return false;
      }
      throw error;
    }
  }

  async stat(scope: StorageScope, key: string): Promise<StorageStat> {
    const { client, sdk } = await this.getClientWithSdk();
    const head = await client.send(
      new sdk.HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getObjectKey(scope, key),
      }),
    );
    return { size: head.ContentLength ?? 0 };
  }

  async deletePrefix(scope: StorageScope, keyPrefix: string): Promise<void> {
    const { client, sdk } = await this.getClientWithSdk();
    const prefix = this.getPrefix(scope, keyPrefix);

    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new sdk.ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      const objects =
        list.Contents?.map((entry: { Key?: string }) => entry.Key).filter(
          (item: string | undefined): item is string => Boolean(item),
        ) ?? [];

      if (objects.length > 0) {
        await client.send(
          new sdk.DeleteObjectsCommand({
            Bucket: this.config.bucket,
            Delete: {
              Objects: objects.map((objectKey: string) => ({ Key: objectKey })),
              Quiet: true,
            },
          }),
        );
      }

      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);
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

  private async getClientWithSdk(): Promise<{ client: any; sdk: any }> {
    const client = await this.getClient();
    if (!this.sdk) {
      throw createError({ statusCode: 500, statusMessage: "S3 SDK did not initialize" });
    }
    return { client, sdk: this.sdk };
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        this.validateConfig();
        const moduleName = "@aws-sdk/client-s3";
        let sdk: any;

        try {
          sdk = await import(moduleName);
        } catch {
          throw createError({
            statusCode: 500,
            statusMessage:
              "S3 storage selected but @aws-sdk/client-s3 is not installed. Add it to dependencies.",
          });
        }

        const credentials =
          this.config.accessKeyId && this.config.secretAccessKey
            ? {
                accessKeyId: this.config.accessKeyId,
                secretAccessKey: this.config.secretAccessKey,
              }
            : undefined;

        this.sdk = sdk;
        this.client = new sdk.S3Client({
          region: this.config.region,
          endpoint: this.config.endpoint || undefined,
          credentials,
          forcePathStyle: this.config.forcePathStyle ?? false,
        });
        return this.client;
      })();
    }
    return await this.clientPromise;
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

  private async toNodeReadable(body: any): Promise<Readable> {
    if (body instanceof Readable) return body;
    if (typeof body?.pipe === "function") return body as Readable;
    const buffer = await this.readBodyToBuffer(body);
    return Readable.from(buffer);
  }

  private async readBodyToBuffer(body: any): Promise<Buffer> {
    if (Buffer.isBuffer(body)) return body;

    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }

    if (typeof body?.transformToByteArray === "function") {
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    }

    if (typeof body?.arrayBuffer === "function") {
      const arrayBuffer = await body.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    if (typeof body?.pipe === "function") {
      return await new Promise<Buffer>((resolveBuffer, rejectBuffer) => {
        const chunks: Buffer[] = [];
        (body as Readable)
          .on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          })
          .on("end", () => {
            resolveBuffer(Buffer.concat(chunks));
          })
          .on("error", rejectBuffer);
      });
    }

    throw createError({ statusCode: 500, statusMessage: "Unsupported S3 response body type" });
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

  async storeFileStream(libraryId: string, fileId: string, stream: Readable): Promise<number> {
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
  ): Promise<Readable> {
    return await this.driver.openReadStream("files", this.fileBlobKey(libraryId, fileId), range);
  }

  async cacheExists(cacheKey: string): Promise<boolean> {
    return await this.driver.exists("cache", cacheKey);
  }

  async openCacheReadStream(cacheKey: string): Promise<Readable> {
    return await this.driver.openReadStream("cache", cacheKey);
  }

  async storeCacheBuffer(cacheKey: string, buffer: Buffer): Promise<void> {
    await this.driver.putBuffer("cache", cacheKey, buffer);
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
  stream: Readable,
): Promise<number> {
  return await useStorageService().storeFileStream(libraryId, fileId, stream);
}

export async function deleteFileFromDisk(libraryId: string, fileId: string): Promise<void> {
  await useStorageService().deleteFile(libraryId, fileId);
}

export async function ensureStorageDir(): Promise<void> {
  await useStorageService().ensureReady();
}
