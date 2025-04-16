import { rm } from "node:fs/promises";
import path from "node:path";
import ExifReader from "exifreader";
import sharp from "sharp";
import { db } from "../db/db";
import { assets } from "../db/schema";
import { getDirectory } from "../utils";

function parsePhotoCreatedAt(exifTags: ExifReader.Tags): Date {
	const dateTimeOriginal = exifTags.DateTimeOriginal?.description;
	if (!dateTimeOriginal) return new Date();

	// Parse EXIF format: "YYYY:MM:DD HH:MM:SS"
	const [date, time] = dateTimeOriginal.split(" ");
	const [year, month, day] = date.split(":").map(Number);
	const [hour, minute, second] = time.split(":").map(Number);
	return new Date(year, month - 1, day, hour, minute, second);
}

export async function createAsset(tmpFilePath: string) {
	const metadata = await sharp(tmpFilePath).metadata();
	const exiftags = await ExifReader.load(tmpFilePath);
	const photoCreatedAt = parsePhotoCreatedAt(exiftags);

	console.debug("Metadata", metadata);
	console.debug("Exif Tags", exiftags);
	console.debug("Photo Created At", photoCreatedAt);

	const { directory, id } = getDirectory("assetDir");
	const originalExtension = metadata.format;
	const storagePath = `${directory}/${id}.${originalExtension}`;
	await Bun.write(Bun.file(storagePath), tmpFilePath);

	const [asset] = await db
		.insert(assets)
		.values({
			id,
			status: "READY",
			exif: exiftags,
			sourceStoragePath: storagePath,
			// optimizedStoragePath: storagePath,
			// TODO :: Add optimized storage path
			cTime: photoCreatedAt,
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.returning();

	const tmpFileDir = path.dirname(tmpFilePath);
	await rm(tmpFileDir, { recursive: true, force: true });

	return asset;
}
