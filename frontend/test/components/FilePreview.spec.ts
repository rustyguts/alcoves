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
  apiUrl: (path: string) => path,
}));

const stubs = {
  AppIcon: { template: "<svg :data-name='name' />", props: ["name", "class"] },
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

  it("keeps low-resolution images near their natural size", () => {
    const file = makeFile({
      id: "img-small",
      name: "small.jpg",
      mimeType: "image/jpeg",
      width: 640,
      height: 480,
    });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });

    const style = wrapper.find("img").attributes("style");
    expect(style).toContain("max-height: 480px;");
    expect(style).toContain("max-width: 640px;");
  });

  it("allows large images to use the full preview area", () => {
    const file = makeFile({
      id: "img-large",
      name: "large.jpg",
      mimeType: "image/jpeg",
      width: 2560,
      height: 1440,
    });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });

    expect(wrapper.find("img").attributes("style")).toBeUndefined();
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

    // Should have both previous and next navigation buttons (identified by icon name)
    const svgs = wrapper.findAll("svg");
    const prevIcon = svgs.find((s) => s.attributes("data-name") === "i-lucide-chevron-left");
    const nextIcon = svgs.find((s) => s.attributes("data-name") === "i-lucide-chevron-right");

    expect(prevIcon?.exists()).toBe(true);
    expect(nextIcon?.exists()).toBe(true);
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

    const svgs = wrapper.findAll("svg");
    const prevIcon = svgs.find((s) => s.attributes("data-name") === "i-lucide-chevron-left");
    expect(prevIcon).toBeUndefined();
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

    const svgs = wrapper.findAll("svg");
    const nextIcon = svgs.find((s) => s.attributes("data-name") === "i-lucide-chevron-right");
    expect(nextIcon).toBeUndefined();
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

    // Find the next button by looking for the button containing the chevron-right icon
    const svgs = wrapper.findAll("svg");
    const nextIcon = svgs.find((s) => s.attributes("data-name") === "i-lucide-chevron-right");
    // Click the parent button
    await nextIcon?.element.closest("button")?.click();
    await nextTick();

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
    expect(wrapper.find("svg").exists()).toBe(true);
  });

  it("computes previewType=audio for audio mimes", () => {
    const file = makeFile({ id: "f1", name: "song.mp3", mimeType: "audio/mpeg" });
    const wrapper = mount(FilePreview, {
      props: { file, libraryId: "lib-1", files: [file], open: true },
      global: { stubs },
    });
    expect(wrapper.find("svg").exists()).toBe(true);
  });

  it("falls back to direct file URL when no playback source is selected", () => {
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
    expect(vm.videoSrc).toBe("/api/libraries/lib-1/files/vid-1?inline=true");
    expect(vm.mediaSrc.type).toBe("video/x-matroska");
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

  describe("adjacent image preloading", () => {
    let loadedSrcs: string[];
    let OriginalImage: typeof Image;

    beforeEach(() => {
      loadedSrcs = [];
      OriginalImage = globalThis.Image;
      globalThis.Image = class {
        private _src = "";
        get src() {
          return this._src;
        }
        set src(val: string) {
          this._src = val;
          loadedSrcs.push(val);
        }
      } as unknown as typeof Image;
    });

    afterEach(() => {
      globalThis.Image = OriginalImage;
    });

    it("preloads previous and next image files when the preview is open", async () => {
      const files = [
        makeFile({ id: "prev", name: "prev.jpg", mimeType: "image/jpeg" }),
        makeFile({ id: "curr", name: "curr.jpg", mimeType: "image/jpeg" }),
        makeFile({ id: "next", name: "next.jpg", mimeType: "image/jpeg" }),
      ];

      mount(FilePreview, {
        props: { file: files[1]!, libraryId: "lib-1", files, open: true },
        global: { stubs },
      });

      await nextTick();

      expect(loadedSrcs).toContain(
        "/api/files/proxy/lib-1/prev?format=jpeg&height=1080&quality=90&width=1920",
      );
      expect(loadedSrcs).toContain(
        "/api/files/proxy/lib-1/next?format=jpeg&height=1080&quality=90&width=1920",
      );
    });

    it("does not preload non-image adjacent files", async () => {
      const files = [
        makeFile({ id: "prev", name: "prev.mp4", mimeType: "video/mp4" }),
        makeFile({ id: "curr", name: "curr.jpg", mimeType: "image/jpeg" }),
        makeFile({ id: "next", name: "next.pdf", mimeType: "application/pdf" }),
      ];

      mount(FilePreview, {
        props: { file: files[1]!, libraryId: "lib-1", files, open: true },
        global: { stubs },
      });

      await nextTick();

      expect(loadedSrcs).toHaveLength(0);
    });

    it("does not preload when the preview is closed", async () => {
      const files = [
        makeFile({ id: "prev", name: "prev.jpg", mimeType: "image/jpeg" }),
        makeFile({ id: "curr", name: "curr.jpg", mimeType: "image/jpeg" }),
        makeFile({ id: "next", name: "next.jpg", mimeType: "image/jpeg" }),
      ];

      mount(FilePreview, {
        props: { file: files[1]!, libraryId: "lib-1", files, open: false },
        global: { stubs },
      });

      await nextTick();

      expect(loadedSrcs).toHaveLength(0);
    });

    it("preloads only the next image when on the first file", async () => {
      const files = [
        makeFile({ id: "first", name: "first.jpg", mimeType: "image/jpeg" }),
        makeFile({ id: "second", name: "second.jpg", mimeType: "image/jpeg" }),
      ];

      mount(FilePreview, {
        props: { file: files[0]!, libraryId: "lib-1", files, open: true },
        global: { stubs },
      });

      await nextTick();

      expect(loadedSrcs).toHaveLength(1);
      expect(loadedSrcs[0]).toContain("lib-1/second");
    });

    it("preloads only the previous image when on the last file", async () => {
      const files = [
        makeFile({ id: "first", name: "first.jpg", mimeType: "image/jpeg" }),
        makeFile({ id: "second", name: "second.jpg", mimeType: "image/jpeg" }),
      ];

      mount(FilePreview, {
        props: { file: files[1]!, libraryId: "lib-1", files, open: true },
        global: { stubs },
      });

      await nextTick();

      expect(loadedSrcs).toHaveLength(1);
      expect(loadedSrcs[0]).toContain("lib-1/first");
    });

    it("respects file dimensions when building the preload URL", async () => {
      const files = [
        makeFile({ id: "prev", name: "prev.jpg", mimeType: "image/jpeg", width: 800, height: 600 }),
        makeFile({ id: "curr", name: "curr.jpg", mimeType: "image/jpeg" }),
      ];

      mount(FilePreview, {
        props: { file: files[1]!, libraryId: "lib-1", files, open: true },
        global: { stubs },
      });

      await nextTick();

      expect(loadedSrcs).toHaveLength(1);
      expect(loadedSrcs[0]).toContain("width=800");
      expect(loadedSrcs[0]).toContain("height=600");
    });
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
