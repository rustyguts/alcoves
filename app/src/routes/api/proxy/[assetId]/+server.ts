import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "$lib/db/db";
import { assets } from "$lib/db/schema/asset";
import { getBaseDirectories } from "$lib/server/utils";
import { error } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { v5 as uuidv5 } from "uuid";

// Except /api/proxy/${asset.id}.avif?width=400

// Generate cache key using UUID v5 with asset id and sorted query params
function generateCacheKey(assetPath: string, queryParams: URLSearchParams) {
	// Sort query params alphabetically
	const sortedParams = [...queryParams.entries()]
		.sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
		.map(([key, value]) => `${key}=${value}`)
		.join("&");

	// Use UUID v5 with asset path as namespace and sorted params as name
	const namespace = uuidv5(assetPath, uuidv5.URL);
	const cacheKey = uuidv5(sortedParams, namespace);

	return cacheKey;
}

function getCacheFilePath(cacheKey: string, extension: string) {
	const { cacheDir } = getBaseDirectories();
	return join(cacheDir, `${cacheKey}.${extension}`);
}

export async function GET({ url, params, request }) {
	const [assetId, extension = "jpg"] = params.assetId.split(".");
	const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));

	if (!asset) throw error(404, "Asset not found");
	const sourceFile = Bun.file(asset.sourceStoragePath);
	if (!(await sourceFile.exists())) throw error(404, "Asset not found");

	const format = extension.toLowerCase();
	const width = Number.parseInt(url.searchParams.get("width") || "1920");
	const height = Number.parseInt(url.searchParams.get("height") || "1080");

	const cacheKey = generateCacheKey(asset.sourceStoragePath, url.searchParams);
	const cacheFilePath = getCacheFilePath(cacheKey, format);
	const cacheFile = Bun.file(cacheFilePath);
	const responseHeaders = {
		"Content-Type": Bun.file(`image.${format}`).type,
	};

	if (await cacheFile.exists()) {
		return new Response(Bun.file(cacheFilePath), { headers: responseHeaders });
	}

	console.log(asset.sourceStoragePath, cacheFilePath, format, width, height);
	const processedBuffer = await sharp(asset.sourceStoragePath)
		.resize(width, height, {
			fit: "inside",
			withoutEnlargement: true,
		})
		// .rotate()
		.toFormat(format, {
			quality: 80,
			progressive: true,
		})
		.toBuffer();

	await writeFile(cacheFilePath, processedBuffer);
	return new Response(Bun.file(cacheFilePath), { headers: responseHeaders });
}
