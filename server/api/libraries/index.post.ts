import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const userId = event.context.userId as string;
  const body = await readBody<{ name: string }>(event);

  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, statusMessage: "Name is required" });
  }

  const [library] = await db
    .insert(schema.libraries)
    .values({
      name: body.name.trim(),
      ownerId: userId,
    })
    .returning();

  return library;
});
