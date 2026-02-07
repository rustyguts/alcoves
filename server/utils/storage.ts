import { mkdir, rm, writeFile } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

function getStoragePath(): string {
  const config = useRuntimeConfig();
  return resolve(config.storagePath);
}

function getAvatarStoragePath(): string {
  const config = useRuntimeConfig();
  return resolve(config.avatarStoragePath);
}

export function getFilePath(libraryId: string, fileId: string): string {
  return join(getStoragePath(), libraryId, fileId);
}

export function getFileBlobPath(libraryId: string, fileId: string): string {
  return join(getFilePath(libraryId, fileId), "blob");
}

export function getAvatarPath(userId: string): string {
  return join(getAvatarStoragePath(), userId);
}

export function getAvatarBlobPath(userId: string): string {
  return join(getAvatarPath(userId), "avatar.webp");
}

export async function storeFile(libraryId: string, fileId: string, data: Buffer): Promise<void> {
  const dir = getFilePath(libraryId, fileId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "blob"), data);
}

export async function storeAvatar(userId: string, data: Buffer): Promise<void> {
  const dir = getAvatarPath(userId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "avatar.webp"), data);
}

export async function storeFileStream(
  libraryId: string,
  fileId: string,
  stream: Readable,
): Promise<number> {
  const dir = getFilePath(libraryId, fileId);
  await mkdir(dir, { recursive: true });
  let size = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(stream, counter, createWriteStream(join(dir, "blob")));
  return size;
}

export async function deleteFileFromDisk(libraryId: string, fileId: string): Promise<void> {
  const dir = getFilePath(libraryId, fileId);
  await rm(dir, { recursive: true, force: true });
}

export async function ensureStorageDir(): Promise<void> {
  const fileRoot = getStoragePath();
  if (!existsSync(fileRoot)) {
    await mkdir(fileRoot, { recursive: true });
  }

  const avatarRoot = getAvatarStoragePath();
  if (!existsSync(avatarRoot)) {
    await mkdir(avatarRoot, { recursive: true });
  }
}
