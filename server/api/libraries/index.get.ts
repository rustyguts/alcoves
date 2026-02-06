import { eq, or, exists } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const userId = event.context.userId as string;

  const results = await db
    .select({
      id: schema.libraries.id,
      name: schema.libraries.name,
      isDefault: schema.libraries.isDefault,
      ownerId: schema.libraries.ownerId,
      createdAt: schema.libraries.createdAt,
      updatedAt: schema.libraries.updatedAt,
    })
    .from(schema.libraries)
    .where(
      or(
        eq(schema.libraries.ownerId, userId),
        exists(
          db
            .select()
            .from(schema.libraryMembers)
            .where(eq(schema.libraryMembers.libraryId, schema.libraries.id))
            .where(eq(schema.libraryMembers.userId, userId)),
        ),
      ),
    )
    .orderBy(schema.libraries.createdAt);

  return results;
});
