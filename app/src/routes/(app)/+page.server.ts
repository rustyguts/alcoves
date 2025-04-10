import { exists, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "$lib/server/db/db";
import { getAssetsDirectory } from "$lib/server/utils";
// import { db } from "$lib/server/db/db";
// import { assets } from "$lib/server/db/schema";
// import { AssetTasks, assetProcessingQueue } from "$lib/server/tasks/queues";
import { type Actions, fail } from "@sveltejs/kit";
import { randomUUIDv7 } from "bun";
import sharp from "sharp";
import { z } from "zod";
// import { and, eq, inArray } from "drizzle-orm";
import type { PageServerLoad } from "./$types";

import ExifReader from "exifreader";

// import { dispatchAssetNotification } from "$lib/server/services/notify";

const mimeTypeValidator = z.string().refine((val) => val.startsWith("image/"), {
	message: "Invalid MIME type. Must be an image type",
});

const uploadSchema = z.object({
	filename: z.string().min(1, { message: "Filename is required" }),
	type: mimeTypeValidator,
});

const validateFormData = async <T extends z.ZodSchema>(
	formData: FormData,
	schema: T,
): Promise<
	{ success: true; data: z.infer<T> } | { success: false; error: z.ZodError }
> => {
	try {
		const data = Object.fromEntries(formData);
		const validatedData = await schema.parseAsync(data);
		return { success: true, data: validatedData };
	} catch (error) {
		if (error instanceof z.ZodError) {
			return { success: false, error };
		}
		throw error;
	}
};

export const load: PageServerLoad = async ({ locals }) => {
	// const getDeleted = false;

	// const assetsList = await db.query.assets.findMany({
	// 	orderBy: (assets, { desc }) => [desc(assets.createdAt)],
	// 	with: {
	// 		proxies: {
	// 			orderBy: (proxies, { desc }) => [desc(proxies.status)],
	// 		},
	// 	},
	// 	where: (assets, { eq }) =>
	// 		eq(assets.ownerId, locals.user.id) && eq(assets.deleted, getDeleted),
	// });

	// // Create URLs for local files
	// const enrichedAssets = assetsList.map((asset) => {
	// 	const filename = path.basename(asset.storageKey);

	// 	return {
	// 		...asset,
	// 		thumbnail: {
	// 			url: `/uploads/${asset.storagePrefix}/${filename}`,
	// 			type: "IMAGE",
	// 			isDefault: true,
	// 		},
	// 	};
	// });

	const assets = await readdir(getAssetsDirectory());

	return {
		assets: await Promise.all(
			assets.map(async (asset) => {
				const fileUrl = `${getAssetsDirectory()}/${asset}/${asset}.JPG`;

				// const tags = await ExifReader.load(fileUrl);
				// const datetime = tags.DateTimeOriginal?.description || "Unknown";

				return {
					id: asset,
					// exif: tags,
					createdAt: new Date().toISOString(),
				};
			}),
		),
	};
};

export const actions = {
	upload: async ({ request, locals }) => {
		// if (!locals.user) return fail(401);
		const formData = await request.formData();

		// Validate metadata
		const validation = await validateFormData(formData, uploadSchema);
		if (!validation.success) {
			return fail(400, {
				error: true,
				message: "Invalid form data",
				issues: validation.error.issues,
			});
		}

		const { filename, type } = validation.data;
		const file = formData.get("file");

		if (!file || !(file instanceof File)) {
			return fail(400, {
				error: true,
				message: "No file provided or invalid file",
			});
		}

		// Generate asset ID and create storage path
		const assetId = randomUUIDv7();
		const assetDir = path.join(await getAssetsDirectory(), assetId);

		// Create directory for this asset
		await mkdir(assetDir, { recursive: true });

		// Create storage path and filename
		const fileExtension = path.extname(filename);
		const storageFilename = `${assetId}${fileExtension}`;
		const storagePath = path.join(assetDir, storageFilename);

		// Convert file to buffer and write to disk
		// TODO :: Refactor this to use streams
		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		await writeFile(storagePath, buffer);

		const tags = await ExifReader.load(storagePath);
		const photoCreatedAt =
			tags.DateTimeOriginal?.description || new Date().toISOString();

		// Insert into database
		// const [asset] = await db
		// 	.insert(assets)
		// 	.values({
		// 		id: assetId,
		// 		ownerId: "test" || locals?.user?.id,
		// 		type: "IMAGE",
		// 		status: "UPLOADED",
		// 		title: path.parse(filename).name,
		// 		filename,
		// 		mimeType: type,
		// 		storagePrefix: assetId,
		// 		storageKey,
		// 		storageBucket: "local", // No longer using S3 buckets
		// 	})
		// 	.returning();

		// await dispatchAssetNotification("assets", "ASSET_CREATED", [asset]);
		// await assetProcessingQueue.add(AssetTasks.INGEST_ASSET, { assetId });

		return {
			success: true,
			assetId,
			url: `/uploads/${assetId}/${storageFilename}`,
		};
	},
} satisfies Actions;
