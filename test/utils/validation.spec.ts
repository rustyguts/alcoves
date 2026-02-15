import { z } from "zod";

// The server util `parseBodyWithSchema` uses auto-imported `readBody` and `createError`.
// In the nuxt test environment these are available as globals, so we stub them.

describe("parseBodyWithSchema", () => {
  const testSchema = z.object({
    name: z.string().min(1, "Name is required"),
    age: z.number().int().positive("Age must be positive"),
  });

  // Dynamically import so stubs are in place
  async function getParser() {
    const mod = await import("~~/server/utils/validation");
    return mod.parseBodyWithSchema;
  }

  beforeEach(() => {
    // Stub the Nitro auto-imports that are not available in the nuxt test env
    vi.stubGlobal(
      "readBody",
      vi.fn(async (event: { _body: unknown }) => event._body),
    );
    vi.stubGlobal(
      "createError",
      vi.fn((opts: { statusCode: number; statusMessage: string }) => {
        const error = new Error(opts.statusMessage) as Error & {
          statusCode: number;
          statusMessage: string;
        };
        error.statusCode = opts.statusCode;
        error.statusMessage = opts.statusMessage;
        return error;
      }),
    );
  });

  function createMockEvent(body: unknown) {
    return { _body: body } as never;
  }

  it("returns parsed data for valid body", async () => {
    const parseBodyWithSchema = await getParser();
    const event = createMockEvent({ name: "Alice", age: 30 });
    const result = await parseBodyWithSchema(event, testSchema);
    expect(result).toEqual({ name: "Alice", age: 30 });
  });

  it("throws 400 for missing required fields", async () => {
    const parseBodyWithSchema = await getParser();
    const event = createMockEvent({ name: "Alice" });
    await expect(parseBodyWithSchema(event, testSchema)).rejects.toThrow();
  });

  it("throws 400 for invalid field types", async () => {
    const parseBodyWithSchema = await getParser();
    const event = createMockEvent({ name: "Alice", age: "not-a-number" });
    await expect(parseBodyWithSchema(event, testSchema)).rejects.toThrow();
  });

  it("throws with the first zod issue message", async () => {
    const parseBodyWithSchema = await getParser();
    const event = createMockEvent({ name: "", age: -1 });
    await expect(parseBodyWithSchema(event, testSchema)).rejects.toThrow("Name is required");
  });

  it("strips unknown keys", async () => {
    const parseBodyWithSchema = await getParser();
    const event = createMockEvent({ name: "Alice", age: 30, extra: "field" });
    const result = await parseBodyWithSchema(event, testSchema);
    expect(result).toEqual({ name: "Alice", age: 30 });
    expect(result).not.toHaveProperty("extra");
  });
});
