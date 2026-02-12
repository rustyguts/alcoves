import type { ZodType } from "zod";

export async function parseBodyWithSchema<T>(
  event: Parameters<typeof readBody>[0],
  schema: ZodType<T>,
): Promise<T> {
  const body = await readBody(event);
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw createError({
      statusCode: 400,
      statusMessage: issue?.message ?? "Invalid request body",
    });
  }
  return result.data;
}
