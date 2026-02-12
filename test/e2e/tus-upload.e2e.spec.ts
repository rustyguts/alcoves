import { expect, test } from "@playwright/test";

/**
 * E2E test for the tus resumable upload pipeline.
 *
 * This test exercises the full stack: browser → tus server → storage → DB.
 * It uses Playwright's API request context (not browser page navigation)
 * to speak the tus protocol directly against the running Nuxt server.
 *
 * Prerequisites: PostgreSQL must be running (docker-compose up postgres).
 */

const BASE = "http://127.0.0.1:4173";

// Unique email per test run to avoid collisions
const testEmail = `tus-e2e-${Date.now()}@test.local`;
const testPassword = "test-password-123";
const testName = "Tus Test User";

test.describe("tus upload", () => {
  let cookie: string;
  let libraryId: string;

  test.beforeAll(async ({ request }) => {
    // Register a fresh user — this returns a Set-Cookie header with the session
    const registerRes = await request.post(`${BASE}/api/auth/register`, {
      data: {
        name: testName,
        email: testEmail,
        password: testPassword,
      },
    });
    expect(registerRes.status()).toBe(200);

    // Extract the session cookie for subsequent requests
    const setCookies = registerRes.headers()["set-cookie"];
    expect(setCookies).toBeTruthy();
    // set-cookie may be a single string or joined with ", " — extract the nuxt-session cookie
    const sessionMatch = setCookies!.match(/nuxt-session=[^;]+/);
    expect(sessionMatch).toBeTruthy();
    cookie = sessionMatch![0];

    // Fetch the user's libraries to get the default library ID
    const libRes = await request.get(`${BASE}/api/libraries`, {
      headers: { cookie },
    });
    expect(libRes.status()).toBe(200);
    const libraries = await libRes.json();
    expect(libraries.length).toBeGreaterThanOrEqual(1);
    libraryId = libraries[0].id;
    expect(libraryId).toBeTruthy();
  });

  test("uploads a file via tus protocol and verifies it in the library", async ({ request }) => {
    const fileContent = "Hello from the tus e2e test! " + Date.now();
    const fileBytes = Buffer.from(fileContent, "utf-8");
    const fileName = "tus-test-file.txt";

    // ---------------------------------------------------------------
    // Step 1: Create the upload (POST /api/tus)
    // ---------------------------------------------------------------
    // tus metadata is base64-encoded key-value pairs in the Upload-Metadata header
    const metadata = [
      `libraryId ${Buffer.from(libraryId).toString("base64")}`,
      `filename ${Buffer.from(fileName).toString("base64")}`,
      `mimeType ${Buffer.from("text/plain").toString("base64")}`,
    ].join(",");

    const createRes = await request.fetch(`${BASE}/api/tus`, {
      method: "POST",
      headers: {
        cookie,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(fileBytes.length),
        "Upload-Metadata": metadata,
        "Content-Length": "0",
      },
    });

    expect(createRes.status()).toBe(201);
    const uploadUrl = createRes.headers()["location"];
    expect(uploadUrl).toBeTruthy();

    // The location header may be absolute or relative
    const fullUploadUrl = uploadUrl!.startsWith("http")
      ? uploadUrl!
      : `${BASE}${uploadUrl}`;

    // ---------------------------------------------------------------
    // Step 2: Upload the file data (PATCH {uploadUrl})
    // ---------------------------------------------------------------
    const patchRes = await request.fetch(fullUploadUrl, {
      method: "PATCH",
      headers: {
        cookie,
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": "0",
        "Content-Type": "application/offset+octet-stream",
      },
      data: fileBytes,
    });

    expect(patchRes.status()).toBe(204);
    const finalOffset = patchRes.headers()["upload-offset"];
    expect(Number(finalOffset)).toBe(fileBytes.length);

    // ---------------------------------------------------------------
    // Step 3: Verify the file appears in the library listing
    // ---------------------------------------------------------------
    // Allow a brief moment for the POST_FINISH handler to complete
    await new Promise((r) => setTimeout(r, 1000));

    const listRes = await request.get(`${BASE}/api/libraries/${libraryId}/files`, {
      headers: { cookie },
    });
    expect(listRes.status()).toBe(200);
    const listing = await listRes.json();

    // Find our uploaded file by name
    const uploadedFile = listing.entries.find(
      (f: { name: string; kind: string }) => f.name === fileName && f.kind === "file",
    );
    expect(uploadedFile).toBeTruthy();
    expect(uploadedFile.mimeType).toBe("text/plain");
    expect(Number(uploadedFile.size)).toBe(fileBytes.length);

    // ---------------------------------------------------------------
    // Step 4: Download the file and verify its content
    // ---------------------------------------------------------------
    const downloadRes = await request.get(
      `${BASE}/api/libraries/${libraryId}/files/${uploadedFile.id}`,
      {
        headers: { cookie },
      },
    );
    expect(downloadRes.status()).toBe(200);
    const downloadedBody = await downloadRes.text();
    expect(downloadedBody).toBe(fileContent);
  });

  test("resumes an interrupted upload", async ({ request }) => {
    const fileContent = "A".repeat(1024) + "B".repeat(1024);
    const fileBytes = Buffer.from(fileContent, "utf-8");
    const fileName = "tus-resume-test.txt";

    const metadata = [
      `libraryId ${Buffer.from(libraryId).toString("base64")}`,
      `filename ${Buffer.from(fileName).toString("base64")}`,
      `mimeType ${Buffer.from("text/plain").toString("base64")}`,
    ].join(",");

    // Create the upload
    const createRes = await request.fetch(`${BASE}/api/tus`, {
      method: "POST",
      headers: {
        cookie,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(fileBytes.length),
        "Upload-Metadata": metadata,
        "Content-Length": "0",
      },
    });
    expect(createRes.status()).toBe(201);
    const uploadUrl = createRes.headers()["location"]!;
    const fullUploadUrl = uploadUrl.startsWith("http")
      ? uploadUrl
      : `${BASE}${uploadUrl}`;

    // Upload first half
    const firstHalf = fileBytes.subarray(0, 1024);
    const patch1 = await request.fetch(fullUploadUrl, {
      method: "PATCH",
      headers: {
        cookie,
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": "0",
        "Content-Type": "application/offset+octet-stream",
      },
      data: firstHalf,
    });
    expect(patch1.status()).toBe(204);
    expect(Number(patch1.headers()["upload-offset"])).toBe(1024);

    // Check current offset via HEAD (simulates resume)
    const headRes = await request.fetch(fullUploadUrl, {
      method: "HEAD",
      headers: {
        cookie,
        "Tus-Resumable": "1.0.0",
      },
    });
    expect(headRes.status()).toBe(200);
    expect(Number(headRes.headers()["upload-offset"])).toBe(1024);

    // Upload second half from the offset
    const secondHalf = fileBytes.subarray(1024);
    const patch2 = await request.fetch(fullUploadUrl, {
      method: "PATCH",
      headers: {
        cookie,
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": "1024",
        "Content-Type": "application/offset+octet-stream",
      },
      data: secondHalf,
    });
    expect(patch2.status()).toBe(204);
    expect(Number(patch2.headers()["upload-offset"])).toBe(fileBytes.length);

    // Verify file appears in listing
    await new Promise((r) => setTimeout(r, 1000));

    const listRes = await request.get(`${BASE}/api/libraries/${libraryId}/files`, {
      headers: { cookie },
    });
    expect(listRes.status()).toBe(200);
    const listing = await listRes.json();

    const uploadedFile = listing.entries.find(
      (f: { name: string; kind: string }) => f.name === fileName && f.kind === "file",
    );
    expect(uploadedFile).toBeTruthy();
    expect(Number(uploadedFile.size)).toBe(fileBytes.length);

    // Verify full content
    const downloadRes = await request.get(
      `${BASE}/api/libraries/${libraryId}/files/${uploadedFile.id}`,
      {
        headers: { cookie },
      },
    );
    expect(downloadRes.status()).toBe(200);
    const downloaded = await downloadRes.text();
    expect(downloaded).toBe(fileContent);
  });

  test("rejects upload without authentication", async ({ request }) => {
    const createRes = await request.fetch(`${BASE}/api/tus`, {
      method: "POST",
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Length": "10",
        "Upload-Metadata": `libraryId ${Buffer.from("fake-lib").toString("base64")},filename ${Buffer.from("test.txt").toString("base64")}`,
        "Content-Length": "0",
      },
    });
    expect(createRes.status()).toBe(401);
  });

  test("rejects upload to non-existent library", async ({ request }) => {
    const fakeLibraryId = "00000000-0000-0000-0000-000000000000";
    const metadata = [
      `libraryId ${Buffer.from(fakeLibraryId).toString("base64")}`,
      `filename ${Buffer.from("test.txt").toString("base64")}`,
    ].join(",");

    const createRes = await request.fetch(`${BASE}/api/tus`, {
      method: "POST",
      headers: {
        cookie,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": "10",
        "Upload-Metadata": metadata,
        "Content-Length": "0",
      },
    });
    // Should be 403 (no access) since library doesn't exist / user has no access
    expect(createRes.status()).toBe(403);
  });

  test("rejects upload with missing metadata", async ({ request }) => {
    // No libraryId in metadata
    const metadata = `filename ${Buffer.from("test.txt").toString("base64")}`;

    const createRes = await request.fetch(`${BASE}/api/tus`, {
      method: "POST",
      headers: {
        cookie,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": "10",
        "Upload-Metadata": metadata,
        "Content-Length": "0",
      },
    });
    expect(createRes.status()).toBe(400);
  });
});
