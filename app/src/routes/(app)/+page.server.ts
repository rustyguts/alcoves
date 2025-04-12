import path from "node:path";
import { getDirectory } from "$lib/server/utils";
import { type Actions, fail } from "@sveltejs/kit";
import { z } from "zod";
import type { PageServerLoad } from "./$types";

import { db } from "$lib/server/db/db";
import { createAsset } from "$lib/server/svc/assets";

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
	const assetsList = await db.query.assets.findMany({
		orderBy: (assets, { desc }) => [desc(assets.cTime)],
		// where: (assets, { eq }) =>
		// 	eq(assets.ownerId, locals.user.id) && eq(assets.deleted, getDeleted),
	});

	console.log("Assets Fetched", assetsList);

	return {
		assets: await Promise.all(
			assetsList.map(async (asset) => {
				return {
					id: asset.id,
					createdAt: asset.cTime?.toISOString(),
				};
			}),
		),
	};
};

export const actions = {
	upload: async ({ request, locals }) => {
		// if (!locals.user) return fail(401);
		const formData = await request.formData();

		const validation = await validateFormData(formData, uploadSchema);
		if (!validation.success) {
			return fail(400, {
				error: true,
				message: "Invalid form data",
				issues: validation.error.issues,
			});
		}

		const { filename } = validation.data;
		const file = formData.get("file");

		if (!file || !(file instanceof File)) {
			return fail(400, {
				error: true,
				message: "No file provided or invalid file",
			});
		}

		const { directory } = await getDirectory("tmpDir");
		const tmpFilePath = path.join(directory, filename);
		await Bun.write(tmpFilePath, file);

		const asset = await createAsset(tmpFilePath);
		return { success: true };
	},
} satisfies Actions;
