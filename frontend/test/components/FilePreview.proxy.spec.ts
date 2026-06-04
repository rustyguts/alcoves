import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilePreview from "~/components/FilePreview.vue";
import type { LibraryFile } from "~~/shared/types/api";

const apiFetch = vi.fn().mockResolvedValue(undefined);

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

const stubs = {
  AppIcon: { template: "<i :data-name='name' />", props: ["name", "class"] },
  AlcovesImage: { template: "<img />", props: ["libraryId", "fileId", "alt", "width", "class"] },
  "media-player": { template: "<div class='media-player'><slot /></div>", props: ["src", "title"] },
  "media-provider": { template: "<div />" },
  "media-video-layout": { template: "<div />" },
  "media-audio-layout": { template: "<div />" },
};

function makeFile(over: Partial<LibraryFile> = {}): LibraryFile {
  return {
    id: "f1",
    libraryId: "lib1",
    parentFolderId: null,
    name: "clip.mp4",
    mimeType: "video/mp4",
    size: 100,
    kind: "file",
    trashedAt: null,
    createdAt: "",
    updatedAt: "",
    owner: null,
    tags: [],
    ...over,
  } as LibraryFile;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  apiFetch.mockReset().mockResolvedValue(undefined);
});

async function mountPreview(file: LibraryFile) {
  const wrapper = mount(FilePreview, {
    props: { file, libraryId: "lib1", files: [file], open: true },
    global: { stubs },
  });
  await flushPromises();
  return wrapper;
}

describe("FilePreview video proxy", () => {
  it("shows a processing overlay with a percentage and ETA", async () => {
    const wrapper = await mountPreview(
      makeFile({ proxyStatus: "processing", proxyProgress: 50, proxyEtaSeconds: 3661 }),
    );
    const text = wrapper.text();
    expect(text).toContain("50%");
    // 3661s → 1h 1m
    expect(text).toContain("1h 1m");
  });

  it("formats a minutes/seconds ETA", async () => {
    const wrapper = await mountPreview(
      makeFile({ proxyStatus: "queued", proxyProgress: 10, proxyEtaSeconds: 95 }),
    );
    expect(wrapper.text()).toContain("1m 35s");
  });

  it("formats a seconds-only ETA", async () => {
    const wrapper = await mountPreview(
      makeFile({ proxyStatus: "processing", proxyProgress: 0, proxyEtaSeconds: 42 }),
    );
    expect(wrapper.text()).toContain("42s");
  });

  it("clamps progress into the 0–100 range", async () => {
    const wrapper = await mountPreview(
      makeFile({ proxyStatus: "processing", proxyProgress: 250, proxyEtaSeconds: null }),
    );
    expect(wrapper.text()).toContain("100%");
  });
});
