import { test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { addOverride, createMockApi } from "../helpers/mock-api";
import { fulfillJson } from "../helpers/fulfill";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";

const FLOW = "timeline";

// A rich, varied-aspect timeline data set spanning several months so the
// justified (Google-Photos-style) gallery has portrait/landscape/square mixes
// and month + day headings to render. Newest-first, as the real endpoint emits.
// [w, h, ISO date, isVideo?, durationSeconds?]; a few flagged as video.
const SPEC: Array<[number, number, string, boolean?, number?]> = [
  // Wed, Jan 14 2026 — busy day, mixed orientations
  [4000, 3000, "2026-01-14T18:10:00Z"],
  [2000, 3000, "2026-01-14T17:55:00Z"],
  [1920, 1080, "2026-01-14T17:40:00Z", true, 95],
  [3000, 3000, "2026-01-14T17:20:00Z"],
  [4096, 2160, "2026-01-14T16:00:00Z"],
  [2400, 3600, "2026-01-14T15:30:00Z"],
  [3840, 2160, "2026-01-14T15:00:00Z"],
  [1500, 2000, "2026-01-14T14:10:00Z"],
  // Sun, Jan 11 2026
  [4000, 2667, "2026-01-11T12:00:00Z"],
  [3000, 4000, "2026-01-11T11:30:00Z"],
  [1080, 1080, "2026-01-11T10:15:00Z", true, 312],
  [5000, 2000, "2026-01-11T09:00:00Z"],
  [2200, 3300, "2026-01-11T08:40:00Z"],
  // Tue, Dec 23 2025 (prior year → heading shows the year)
  [4000, 3000, "2025-12-23T20:00:00Z"],
  [1280, 720, "2025-12-23T19:30:00Z", true, 3725],
  [3024, 4032, "2025-12-23T18:00:00Z"],
  [4032, 3024, "2025-12-23T17:00:00Z"],
  [2048, 1536, "2025-12-23T16:30:00Z"],
  // Mon, Dec 1 2025
  [6000, 4000, "2025-12-01T09:00:00Z"],
  [3000, 2000, "2025-12-01T08:30:00Z"],
  [2000, 2500, "2025-12-01T08:00:00Z"],
];

function buildEntries() {
  return SPEC.map(([width, height, capturedAt, video, duration], i) => {
    const id = `tl-${i}`;
    return {
      id,
      libraryId: "lib-photos",
      parentFolderId: null,
      name: video ? `clip-${i}.mp4` : `photo-${i}.jpg`,
      kind: "file",
      mimeType: video ? "video/mp4" : "image/jpeg",
      size: 2_000_000,
      duration: duration ?? null,
      width,
      height,
      thumbnailReady: true,
      thumbnailFileId: video ? `${id}-poster` : null,
      posterUrl: null,
      trashedAt: null,
      capturedAt,
      createdAt: capturedAt,
      updatedAt: capturedAt,
      owner: { id: "user-owner", name: "Ada Owner", email: "owner@example.com" },
      tags: [],
    };
  });
}

function mockTimeline(state: ReturnType<typeof createDefaultState>) {
  const entries = buildEntries();
  addOverride(state, async (route, url) => {
    // Histogram drives the date scrubber's density blips — match it before the
    // bare /timeline route (which would otherwise swallow the prefix).
    if (/^\/api\/libraries\/[\w-]+\/timeline\/histogram$/.test(url.pathname)) {
      await fulfillJson(route, 200, {
        buckets: [
          { year: 2026, month: 1, count: 13 },
          { year: 2025, month: 12, count: 8 },
        ],
        totalCount: 21,
      });
      return true;
    }
    if (/^\/api\/libraries\/[\w-]+\/timeline$/.test(url.pathname)) {
      await fulfillJson(route, 200, {
        entries,
        breadcrumbs: [],
        nextCursor: null,
        totalCount: entries.length,
      });
      return true;
    }
  });
}

test.describe("Timeline gallery @screenshot", () => {
  test("justified gallery — dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    mockTimeline(state);
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/timeline");

    await page.getByText("Wed, Jan 14").first().waitFor();
    await snap(page, FLOW, "gallery-dark");
  });

  test("justified gallery — light @screenshot", async ({ page }) => {
    const state = createDefaultState();
    mockTimeline(state);
    await setupDeterminism(page);
    await setTheme(page, "light");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/timeline");

    await page.getByText("Wed, Jan 14").first().waitFor();
    await snap(page, FLOW, "gallery-light");
  });

  test("justified gallery — narrow viewport reflow @screenshot", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 900 });
    const state = createDefaultState();
    mockTimeline(state);
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/timeline");

    await page.getByText("Wed, Jan 14").first().waitFor();
    await snap(page, FLOW, "gallery-narrow");
  });

  test("timeline empty state @screenshot", async ({ page }) => {
    const state = createDefaultState();
    addOverride(state, async (route, url) => {
      if (/^\/api\/libraries\/[\w-]+\/timeline$/.test(url.pathname)) {
        await fulfillJson(route, 200, {
          entries: [],
          breadcrumbs: [],
          nextCursor: null,
          totalCount: 0,
        });
        return true;
      }
    });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/timeline");

    await page.getByText("Nothing to show yet").waitFor();
    await snap(page, FLOW, "empty");
  });
});
