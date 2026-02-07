import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "~~/server/database";

const MAX_AVATAR_UPLOAD_BYTES = 25 * 1024 * 1024;
const AVATAR_SIZE = 128;

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event);
  const session = await getUserSession(event);
  const parts = await readMultipartFormData(event);

  if (!parts?.length) {
    throw createError({ statusCode: 400, statusMessage: "No upload data provided" });
  }

  const avatarPart = parts.find((part) => part.name === "avatar" && part.filename && part.data);
  if (!avatarPart) {
    throw createError({ statusCode: 400, statusMessage: "Avatar image is required" });
  }

  const mimeType = avatarPart.type || "application/octet-stream";
  if (!mimeType.startsWith("image/")) {
    throw createError({ statusCode: 400, statusMessage: "Avatar must be an image file" });
  }

  if (!avatarPart.data.byteLength) {
    throw createError({ statusCode: 400, statusMessage: "Avatar image is empty" });
  }

  if (avatarPart.data.byteLength > MAX_AVATAR_UPLOAD_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: "Avatar image is too large (max 25MB)",
    });
  }

  let optimizedAvatar: Buffer;
  try {
    optimizedAvatar = await sharp(avatarPart.data)
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, {
        fit: "cover",
        position: "centre",
      })
      .webp({
        quality: 82,
        effort: 4,
      })
      .toBuffer();
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid image file" });
  }

  await storeAvatar(userId, optimizedAvatar);

  const avatarUrl = `/api/files/proxy/avatar/${userId}?v=${Date.now()}`;

  const [updatedUser] = await db
    .update(schema.users)
    .set({ avatarUrl })
    .where(eq(schema.users.id, userId))
    .returning({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      role: schema.users.role,
    });

  if (!updatedUser) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  await setUserSession(event, {
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.displayName,
      avatarUrl: updatedUser.avatarUrl,
      role: updatedUser.role,
    },
    sessionToken: session.sessionToken,
  });

  return updatedUser;
});
