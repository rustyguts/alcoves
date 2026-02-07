import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import { defineComponent } from "vue";
import UploadProgress from "~/components/UploadProgress.vue";

type UploadItem = {
  id: string;
  file: { name: string };
  libraryName: string;
  status: "pending" | "uploading" | "error" | "done";
  progress: number;
  retries: number;
  error?: string;
};

const mocks = vi.hoisted(() => ({
  activeUploads: [] as UploadItem[],
  uploadSpeed: 0,
  retryFile: vi.fn(),
  removeFile: vi.fn(),
}));

mockNuxtImport("useUploadQueue", () => {
  return () => ({
    activeUploads: mocks.activeUploads,
    hasActiveUploads: mocks.activeUploads.length > 0,
    uploadSpeed: mocks.uploadSpeed,
    retryFile: mocks.retryFile,
    removeFile: mocks.removeFile,
  });
});

const UIconStub = defineComponent({
  name: "UIcon",
  props: {
    name: {
      type: String,
      default: "",
    },
  },
  template: `<i :data-icon="name" />`,
});

const UButtonStub = defineComponent({
  name: "UButton",
  props: {
    label: {
      type: String,
      default: "",
    },
  },
  emits: ["click"],
  template: `<button @click="$emit('click')">{{ label }}</button>`,
});

const UProgressStub = defineComponent({
  name: "UProgress",
  props: {
    modelValue: {
      type: Number,
      default: 0,
    },
  },
  template: `<div data-testid="progress">{{ modelValue }}</div>`,
});

const TransitionStub = defineComponent({
  name: "Transition",
  template: `<div><slot /></div>`,
});

describe("UploadProgress", () => {
  beforeEach(() => {
    mocks.activeUploads = [];
    mocks.uploadSpeed = 0;
    mocks.retryFile.mockReset();
    mocks.removeFile.mockReset();
  });

  async function mountComponent() {
    return mountSuspended(UploadProgress, {
      global: {
        stubs: {
          Teleport: true,
          Transition: TransitionStub,
          UIcon: UIconStub,
          UButton: UButtonStub,
          UProgress: UProgressStub,
        },
      },
    });
  }

  it("does not render anything when there are no active uploads", async () => {
    const wrapper = await mountComponent();
    expect(wrapper.text()).toBe("");
  });

  it("renders upload count, speed, and uploading progress", async () => {
    mocks.activeUploads = [
      {
        id: "1",
        file: { name: "photo.jpg" },
        libraryName: "Media",
        status: "uploading",
        progress: 32,
        retries: 0,
      },
    ];
    mocks.uploadSpeed = 2048;

    const wrapper = await mountComponent();

    expect(wrapper.text()).toContain("Uploading 1 file");
    expect(wrapper.text()).toContain("2 KB/s");
    expect(wrapper.text()).toContain("32%");
    expect(wrapper.text()).toContain("photo.jpg");
    expect(wrapper.text()).toContain("Media");
  });

  it("toggles expanded section when header is clicked", async () => {
    mocks.activeUploads = [
      {
        id: "2",
        file: { name: "doc.pdf" },
        libraryName: "Docs",
        status: "pending",
        progress: 0,
        retries: 0,
      },
    ];

    const wrapper = await mountComponent();
    expect(wrapper.text()).toContain("Waiting...");

    await wrapper.get(".cursor-pointer").trigger("click");
    expect(wrapper.text()).not.toContain("Waiting...");

    await wrapper.get(".cursor-pointer").trigger("click");
    expect(wrapper.text()).toContain("Waiting...");
  });

  it("shows retry/remove controls for error uploads and forwards actions", async () => {
    mocks.activeUploads = [
      {
        id: "3",
        file: { name: "report.csv" },
        libraryName: "Ops",
        status: "error",
        progress: 0,
        retries: 1,
        error: "Upload failed (500)",
      },
    ];

    const wrapper = await mountComponent();

    const retry = wrapper.findAll("button").find((el) => el.text() === "Retry");
    const remove = wrapper.findAll("button").find((el) => el.text() === "Remove");

    await retry?.trigger("click");
    await remove?.trigger("click");

    expect(mocks.retryFile).toHaveBeenCalledWith("3");
    expect(mocks.removeFile).toHaveBeenCalledWith("3");
    expect(wrapper.text()).toContain("Upload failed (500)");
  });
});
