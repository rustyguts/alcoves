import { createReadStream } from "node:fs";
import { constants } from "node:fs";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getBaseAssetsDirectory } from "$lib/server/utils.js";
import { error } from "@sveltejs/kit";
import sharp from "sharp";
import { v5 as uuidv5 } from "uuid";

// Cache directory path
const CACHE_DIR = "/data/cache";

// Except /api/proxy/${asset.id}.avif?width=400

// Generate cache key using UUID v5 with asset id and sorted query params
function generateCacheKey(assetPath, queryParams) {
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

// Ensure cache directory exists
async function ensureCacheDir(dirPath) {
	try {
		await access(dirPath, constants.F_OK);
	} catch (err) {
		// Directory doesn't exist, create it
		await mkdir(dirPath, { recursive: true });
	}
}

// Get cache file path
function getCacheFilePath(cacheKey, format) {
	const extension = format || "jpeg";
	return join(CACHE_DIR, `${cacheKey}.${extension}`);
}

export async function GET({ url, params, request }) {
	// TODO :: Everything in here should be put into a bullmq job so as not to overwhelm the server

	const relativePath = url.pathname.replace(/^\/api\/proxy\//, "");
	const filePath = join(await getBaseAssetsDirectory(), relativePath);
	const fileStat = await stat(filePath);
	const useCache = true;

	if (!fileStat.isFile()) {
		// Actually should return a black screen
		throw error(404, "Not a file");
	}

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
			// Ensure cache directory exists
			await ensureCacheDir(CACHE_DIR);

			// Generate cache key
			const cacheKey = generateCacheKey(filePath, url.searchParams);
			const cacheFilePath = getCacheFilePath(cacheKey, format);

			// Check if image exists in cache
			try {
				await access(cacheFilePath, constants.F_OK);

				// Image exists in cache, return it
				console.info("Returning cached optimized image:", cacheFilePath);
				return new Response(Bun.file(cacheFilePath), {
					headers: {
						"Content-Type": Bun.file(`image.${format || "jpeg"}`).type,
					},
				});
			} catch (err) {
				const processedBuffer = await sharp(filePath)
					.resize(width, height, {
						fit: "inside",
						withoutEnlargement: true,
					})
					.rotate()
					.toFormat(format || "jpeg", {
						quality: 90,
					})
					.toBuffer();

				// Save to cache
				await writeFile(cacheFilePath, processedBuffer);

				console.info("Generated and cached optimized image:", cacheFilePath);
				return new Response(processedBuffer, {
					headers: {
						"Content-Type": Bun.file(`image.${format || "jpeg"}`).type,
					},
				});
			}
		} else {
			// No query string, skip cache
			const readStream = createReadStream(filePath);

			const transform = sharp()
				.resize(width, height, {
					fit: "inside",
					withoutEnlargement: true,
				})
				.toFormat(format || "jpeg", {
					quality: 90,
				});

			const sharpStream = readStream.pipe(transform);
			const contentType = Bun.file(`image.${format || "jpeg"}`).type;

			console.info("Returning optimized image (no cache):", filePath);
			return new Response(sharpStream, {
				headers: {
					"Content-Type": contentType,
				},
			});
		}
	}

	// If no resizing is needed, return the file directly
	console.info("Returning original file:", filePath);
	return new Response(Bun.file(filePath), {
		headers: {
			"Content-Type": "image/jpeg",
		},
	});
}
