import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getBaseDirectories } from "$lib/server/utils.js";
import { error } from "@sveltejs/kit";
import sharp from "sharp";
import { v5 as uuidv5 } from "uuid";
import { db } from "../../../../db/db.js";

// Except /api/proxy/${asset.id}.avif?width=400

// Generate cache key using UUID v5 with asset id and sorted query params
function generateCacheKey(assetPath: string, queryParams) {
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

function getCacheFilePath(cacheKey, format) {
	const { cacheDir } = getBaseDirectories();
	const extension = format || "jpeg";
	return join(cacheDir, `${cacheKey}.${extension}`);
}

export async function GET({ url, params, request }) {
	// TODO :: Everything in here should be put into a bullmq job so as not to overwhelm the server

	const useCache = true;
	const { assetId } = params;

	const asset = await db.query.assets.findFirst({
		where: { id: assetId },
	});

	if (!asset) throw error(404, "Asset not found");
	const sourceFile = Bun.file(asset.storagePath);
	if (!(await sourceFile.exists())) throw error(404, "Asset not found");

	// Get query parameters for resizing if needed
	const width = url.searchParams.get("width")
		? Number.parseInt(url.searchParams.get("width") || "")
		: null;
	const height = url.searchParams.get("height")
		? Number.parseInt(url.searchParams.get("height") || "")
		: null;
	const format = url.searchParams.get("format")
		? url.searchParams.get("format")
		: null;

	// Apply transformations if needed
	if (width || height || format) {
		// Skip the cache for assets without query strings
		if (url.search && useCache) {
			const cacheKey = generateCacheKey(asset.storagePath, url.searchParams);
			const cacheFilePath = getCacheFilePath(cacheKey, format);
			const cacheFile = Bun.file(cacheFilePath);

			if (await cacheFile.exists()) {
				return new Response(Bun.file(cacheFilePath), {
					headers: {
						"Content-Type": Bun.file(`image.${format || "jpeg"}`).type,
					},
				});
			}

			const processedBuffer = await sharp(asset.storagePath)
				.resize(width, height, {
					fit: "inside",
					withoutEnlargement: true,
				})
				.rotate()
				.toFormat(format || "jpeg", {
					quality: 90,
				})
				.toBuffer();

			await writeFile(cacheFilePath, processedBuffer);

			console.info("Generated and cached optimized image:", cacheFilePath);
			return new Response(processedBuffer, {
				headers: {
					"Content-Type": Bun.file(`image.${format || "jpeg"}`).type,
				},
			});

			// } else {
			// 	// No query string, skip cache
			// 	const readStream = createReadStream(filePath);

			// 	const transform = sharp()
			// 		.resize(width, height, {
			// 			fit: "inside",
			// 			withoutEnlargement: true,
			// 		})
			// 		.toFormat(format || "jpeg", {
			// 			quality: 90,
			// 		});

			// 	const sharpStream = readStream.pipe(transform);
			// 	const contentType = Bun.file(`image.${format || "jpeg"}`).type;

			// 	console.info("Returning optimized image (no cache):", filePath);
			// 	return new Response(sharpStream, {
			// 		headers: {
			// 			"Content-Type": contentType,
			// 		},
			// 	});
			// }
		}
	}

	// If no resizing is needed, return the file directly
	// This won't work if the images are raw
	// I think we want the create asset job to always convert as a safe backup
	console.info("Returning original file:", asset.storagePath);
	return new Response(Bun.file(asset.storagePath), {
		headers: {
			"Content-Type": "image/jpeg",
		},
	});
}
