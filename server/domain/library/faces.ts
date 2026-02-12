import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export async function isLibraryFaceRecognitionEnabled(libraryId: string): Promise<boolean> {
  const [library] = await db
    .select({ faceRecognitionEnabled: schema.libraries.faceRecognitionEnabled })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .limit(1);

  return library?.faceRecognitionEnabled ?? false;
}
