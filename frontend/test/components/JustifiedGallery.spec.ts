import { mount } from "@vue/test-utils";
import { beforeAll } from "vitest";
import JustifiedGallery from "~/components/JustifiedGallery.vue";
import type { GalleryGroup } from "~/utils/gallery-types";

// JustifiedGallery observes its width with a ResizeObserver, which jsdom lacks.
// (Per CLAUDE.md it is intentionally not stubbed globally in test/setup.ts.)
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

// thumbnailFileId is null so tiles fall back to a mime icon (AppIcon → stubbed
// UIcon) and we don't pull in AlcovesImage's image-proxy plumbing.
function group(over: Partial<GalleryGroup> & { key: string }): GalleryGroup {
  return {
    sectionLabel: null,
    heading: over.heading ?? over.key,
    count: over.items?.length ?? 0,
    items: [],
    ...over,
  };
}

const TIMELINE_GROUPS: GalleryGroup[] = [
  group({
    key: "2026-0-14",
    heading: "Wed, Jan 14",
    items: [
      { id: "a", libraryId: "lib", thumbnailFileId: null, aspect: 1.5, mime: "image/jpeg", name: "a.jpg", isVideo: false, raw: {} },
      { id: "b", libraryId: "lib", thumbnailFileId: null, aspect: 1, mime: "video/mp4", name: "b.mp4", isVideo: true, durationLabel: "1:35", raw: {} },
    ],
  }),
  group({
    key: "2025-11-23",
    heading: "Dec 23, 2025",
    items: [
      { id: "c", libraryId: "lib", thumbnailFileId: null, aspect: 1.2, mime: "image/jpeg", name: "c.jpg", isVideo: false, raw: {} },
    ],
  }),
];

describe("JustifiedGallery — continuous (timeline) mode", () => {
  it("renders one heading section per day, each with a scroll anchor", () => {
    const wrapper = mount(JustifiedGallery, { props: { continuous: true, groups: TIMELINE_GROUPS } });
    const sections = wrapper.findAll("section[data-group-key]");
    expect(sections).toHaveLength(2);
    const headings = wrapper.findAll("h3").map((h) => h.text());
    expect(headings).toContain("Wed, Jan 14");
    expect(headings).toContain("Dec 23, 2025");
    expect(sections[0]!.attributes("data-group-key")).toBe("2026-0-14");
  });

  it("shows a video's duration with no play icon", () => {
    const wrapper = mount(JustifiedGallery, { props: { continuous: true, groups: TIMELINE_GROUPS } });
    const html = wrapper.html();
    expect(html).toContain("1:35");
    expect(html).not.toContain("i-lineicons-play");
  });

  it("emits select with the raw item when a tile is clicked", async () => {
    const raw = { id: "a", marker: true };
    const groups: GalleryGroup[] = [
      group({
        key: "k",
        heading: "Day",
        items: [{ id: "a", libraryId: "lib", thumbnailFileId: null, aspect: 1, mime: "image/jpeg", name: "a.jpg", isVideo: false, raw }],
      }),
    ];
    const wrapper = mount(JustifiedGallery, { props: { continuous: true, groups } });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([raw]);
  });
});

describe("JustifiedGallery — default (search) mode", () => {
  it("renders a badge and a duration-only video tile when duration is known", () => {
    const groups: GalleryGroup[] = [
      group({
        key: "lib-1",
        heading: "My Library",
        items: [
          { id: "v", libraryId: "lib-1", thumbnailFileId: null, aspect: 1.6, mime: "video/mp4", name: "clip.mp4", isVideo: true, durationLabel: "0:42", badge: "dog, beach", raw: {} },
        ],
      }),
    ];
    const wrapper = mount(JustifiedGallery, { props: { groups } });
    const html = wrapper.html();
    expect(html).toContain("My Library");
    expect(html).toContain("0:42");
    expect(html).toContain("dog, beach");
    expect(html).not.toContain("i-lineicons-play");
  });

  it("falls back to a play badge for a video with no known duration (search results)", () => {
    // Global search results carry no duration; the tile must still be marked as
    // a video so it stays distinguishable from images.
    const groups: GalleryGroup[] = [
      group({
        key: "lib-1",
        heading: "My Library",
        items: [
          { id: "v", libraryId: "lib-1", thumbnailFileId: null, aspect: 1.6, mime: "video/mp4", name: "clip.mp4", isVideo: true, raw: {} },
        ],
      }),
    ];
    const wrapper = mount(JustifiedGallery, { props: { groups } });
    expect(wrapper.html()).toContain("i-lineicons-play");
  });
});
