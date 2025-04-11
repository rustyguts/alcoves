import { rm } from "node:fs/promises";
import path from "node:path";
import ExifReader from "exifreader";
import sharp from "sharp";
import { db } from "../db/db";
import { assets } from "../db/schema";
import { getAssetDirectory } from "../utils";

export async function createAsset(tmpFilePath: string) {
	const metadata = await sharp(tmpFilePath).metadata();
	const exiftags = await ExifReader.load(tmpFilePath);

	const photoCreatedAt =
		exiftags.DateTimeOriginal?.description || new Date().toISOString();

	console.log("Metadata", metadata);
	console.log("Exif Tags", exiftags);
	console.log("Photo Created At", photoCreatedAt);

	const { directory, id } = getAssetDirectory();
	const originalExtension = metadata.format;
	const storagePath = `${directory}/${id}.${originalExtension}`;
	await Bun.write(tmpFilePath, storagePath);

	const [asset] = await db
		.insert(assets)
		.values({
			id,
			storagePath: storagePath,
			cTime: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.returning();

	const tmpFileDir = path.dirname(tmpFilePath);
	await rm(tmpFileDir, { recursive: true, force: true });

	return asset;
}
