import { eq, or, exists, and } from "drizzle-orm";
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
        and(
          eq(schema.libraries.isDefault, false),
          exists(
            db
              .select()
              .from(schema.libraryMembers)
              .where(
                and(
                  eq(schema.libraryMembers.libraryId, schema.libraries.id),
                  eq(schema.libraryMembers.userId, userId),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(schema.libraries.createdAt);

  return results;
});
