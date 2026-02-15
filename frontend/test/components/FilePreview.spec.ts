import { mount } from "@vue/test-utils";
import FilePreview from "~/components/FilePreview.vue";
import type { LibraryFile } from "~~/shared/types/api";

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    data: any;
    constructor(s: number, d: any) {
      super("mock");
      this.status = s;
      this.data = d;
    }
  },
}));

const stubs = {
  UModal: {
    template:
      "<div data-testid='modal' :data-open='String(open)'><slot name='header' /><slot name='body' /></div>",
    props: ["open", "fullscreen", "close", "ui"],
    emits: ["update:open"],
  },
  UButton: {
    template: "<button :data-icon='icon' @click='$emit(\"click\")'><slot /></button>",
    props: ["icon", "color", "variant", "size", "class"],
    emits: ["click"],
  },
  UIcon: { template: "<i :data-name='name' />", props: ["name", "class"] },
  AlcovesImage: {
    template: "<img :alt='alt' />",
    props: ["libraryId", "fileId", "alt", "width", "class"],
  },
  "media-player": {
    template: "<div class='media-player' :data-src='JSON.stringify(src)'><slot /></div>",
    props: ["src", "title", "crossorigin", "playsinline", "autoplay"],
  },
  "media-provider": { template: "<div />" },
  "media-video-layout": { template: "<div />" },
  "media-audio-layout": { template: "<div />" },
};

function makeFile(overrides: Partial<LibraryFile> = {}): LibraryFile {
  return {
    id: "f1",
    libraryId: "lib-1",
    parentFolderId: null,
    name: "test.txt",
    mimeType: "text/plain",
    size: 100,
    kind: "file",
    originalCreatedAt: null,
    trashedAt: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    owner: null,
    tags: [],
    ...overrides,
  };
}

describe("FilePreview", () => {
  it("computes previewType=image for image files", () => {
    const file = makeFile({ id: "f1", name: "photo.jpg", mimeType: "image/jpeg" });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });

    expect(wrapper.find("img").exists()).toBe(true);
  });

  it("computes previewType=pdf for PDF files", () => {
    const file = makeFile({ id: "f1", name: "doc.pdf", mimeType: "application/pdf" });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });

    expect(wrapper.find("iframe").exists()).toBe(true);
  });

  it("computes previewType=unsupported for unknown mimes", () => {
    const file = makeFile({ id: "f1", name: "data.bin", mimeType: "application/octet-stream" });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });

    expect(wrapper.text()).toContain("Preview not available");
    expect(wrapper.text()).toContain("application/octet-stream");
  });

  it("shows file name in header", () => {
    const file = makeFile({ name: "my-document.txt" });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });

    expect(wrapper.text()).toContain("my-document.txt");
  });

  it("shows navigation buttons for multiple files", () => {
    const files = [
      makeFile({ id: "f1", name: "first.txt" }),
      makeFile({ id: "f2", name: "second.txt" }),
      makeFile({ id: "f3", name: "third.txt" }),
    ];

    const wrapper = mount(FilePreview, {
      props: { file: files[1]!, libraryId: "lib-1", files, open: true },
      global: { stubs },
    });

    // Should have both previous and next buttons
    const buttons = wrapper.findAll("button");
    const prevButton = buttons.find((b) => b.attributes("data-icon") === "i-lucide-chevron-left");
    const nextButton = buttons.find((b) => b.attributes("data-icon") === "i-lucide-chevron-right");

    expect(prevButton?.exists()).toBe(true);
    expect(nextButton?.exists()).toBe(true);
  });

  it("hides previous button on first file", () => {
    const files = [
      makeFile({ id: "f1", name: "first.txt" }),
      makeFile({ id: "f2", name: "second.txt" }),
    ];

    const wrapper = mount(FilePreview, {
      props: { file: files[0]!, libraryId: "lib-1", files, open: true },
      global: { stubs },
    });

    const buttons = wrapper.findAll("button");
    const prevButton = buttons.find((b) => b.attributes("data-icon") === "i-lucide-chevron-left");
    expect(prevButton).toBeUndefined();
  });

  it("hides next button on last file", () => {
    const files = [
      makeFile({ id: "f1", name: "first.txt" }),
      makeFile({ id: "f2", name: "second.txt" }),
    ];

    const wrapper = mount(FilePreview, {
      props: { file: files[1]!, libraryId: "lib-1", files, open: true },
      global: { stubs },
    });

    const buttons = wrapper.findAll("button");
    const nextButton = buttons.find((b) => b.attributes("data-icon") === "i-lucide-chevron-right");
    expect(nextButton).toBeUndefined();
  });

  it("emits navigate when clicking next", async () => {
    const files = [
      makeFile({ id: "f1", name: "first.txt" }),
      makeFile({ id: "f2", name: "second.txt" }),
    ];

    const wrapper = mount(FilePreview, {
      props: { file: files[0]!, libraryId: "lib-1", files, open: true },
      global: { stubs },
    });

    const nextButton = wrapper
      .findAll("button")
      .find((b) => b.attributes("data-icon") === "i-lucide-chevron-right");
    await nextButton?.trigger("click");

    expect(wrapper.emitted("navigate")?.[0]).toEqual([files[1]]);
  });

  it("handles keyboard navigation", async () => {
    const files = [
      makeFile({ id: "f1", name: "first.txt" }),
      makeFile({ id: "f2", name: "second.txt" }),
      makeFile({ id: "f3", name: "third.txt" }),
    ];

    const wrapper = mount(FilePreview, {
      props: { file: files[1]!, libraryId: "lib-1", files, open: true },
      global: { stubs },
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await nextTick();
    expect(wrapper.emitted("navigate")?.[0]).toEqual([files[2]]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    await nextTick();
    expect(wrapper.emitted("navigate")?.[1]).toEqual([files[0]]);
  });

  it("computes previewType=video for video mimes", () => {
    const file = makeFile({ id: "f1", name: "clip.mp4", mimeType: "video/mp4" });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });
    // Video player section should exist (showing loader initially since playerReady is false)
    expect(wrapper.find("i").exists()).toBe(true);
  });

  it("computes previewType=audio for audio mimes", () => {
    const file = makeFile({ id: "f1", name: "song.mp3", mimeType: "audio/mpeg" });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });
    expect(wrapper.find("i").exists()).toBe(true);
  });

  it("uses proxy URL for video with proxyStatus=ready", () => {
    const file = makeFile({
      id: "vid-1",
      name: "movie.mkv",
      mimeType: "video/x-matroska",
      proxyStatus: "ready",
    });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });

    // playerReady won't be true yet (async import), but we can check the computed source
    const vm = wrapper.vm as unknown as {
      videoSrc: string;
      mediaSrc: { src: string; type: string };
    };
    expect(vm.videoSrc).toBe("/api/libraries/lib-1/files/vid-1/proxy");
    expect(vm.mediaSrc.type).toBe("video/mp4");
  });

  it("uses direct file URL for video with proxyStatus=not_needed", () => {
    const file = makeFile({
      id: "vid-2",
      name: "clip.mp4",
      mimeType: "video/mp4",
      proxyStatus: "not_needed",
    });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });

    const vm = wrapper.vm as unknown as {
      videoSrc: string;
      mediaSrc: { src: string; type: string };
    };
    expect(vm.videoSrc).toBe("/api/libraries/lib-1/files/vid-2?inline=true");
    expect(vm.mediaSrc.type).toBe("video/mp4");
  });

  it("uses direct file URL for video with null proxyStatus (not yet processed)", () => {
    const file = makeFile({
      id: "vid-3",
      name: "raw.avi",
      mimeType: "video/x-msvideo",
      proxyStatus: null,
    });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });

    const vm = wrapper.vm as unknown as {
      videoSrc: string;
      mediaSrc: { src: string; type: string };
    };
    // Falls back to direct URL when proxy not ready
    expect(vm.videoSrc).toBe("/api/libraries/lib-1/files/vid-3?inline=true");
    expect(vm.mediaSrc.type).toBe("video/x-msvideo");
  });

  it("uses direct file URL for video still processing", () => {
    const file = makeFile({
      id: "vid-4",
      name: "large.mov",
      mimeType: "video/quicktime",
      proxyStatus: "processing",
    });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });

    const vm = wrapper.vm as unknown as {
      videoSrc: string;
      mediaSrc: { src: string; type: string };
    };
    expect(vm.videoSrc).toBe("/api/libraries/lib-1/files/vid-4?inline=true");
    expect(vm.mediaSrc.type).toBe("video/quicktime");
  });
});
