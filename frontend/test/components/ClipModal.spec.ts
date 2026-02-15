import { mount, shallowMount } from "@vue/test-utils";
import ClipModal from "~/components/ClipModal.vue";
import type { LibraryFile } from "~~/shared/types/api";

const mocks = vi.hoisted(() => ({
  toast: { add: vi.fn(), remove: vi.fn(), clear: vi.fn() },
}));

vi.mock("@nuxt/ui/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

const stubs = {
  Modal: {
    template: "<div data-testid='modal'><slot name='body' /></div>",
    props: ["open", "title"],
    emits: ["update:open"],
  },
  Button: {
    template:
      "<button :data-label='label' :disabled='disabled || loading' @click='$emit(\"click\")'><slot />{{ label }}</button>",
    props: ["label", "color", "variant", "loading", "disabled", "icon"],
    emits: ["click"],
  },
  FormField: {
    template: "<div><slot /><slot name='hint' /></div>",
    props: ["label"],
  },
  Input: {
    template:
      "<input :value='modelValue' @input='$emit(\"update:modelValue\", Number($event.target.value) || $event.target.value)' />",
    props: ["modelValue", "type", "min", "max", "step", "placeholder"],
    emits: ["update:modelValue"],
  },
};

const apiFetchMock = vi.fn();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
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

function makeVideoFile(overrides: Partial<LibraryFile> = {}): LibraryFile {
  return {
    id: "video-1",
    libraryId: "lib-1",
    parentFolderId: null,
    name: "sample.mp4",
    mimeType: "video/mp4",
    size: 50_000_000,
    kind: "file",
    duration: 120,
    width: 1920,
    height: 1080,
    proxyStatus: "ready",
    sourceFileId: null,
    originalCreatedAt: null,
    trashedAt: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    owner: null,
    tags: [],
    ...overrides,
  };
}

describe("ClipModal", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue(null);
  });

  it("renders clip form with start/end time fields", () => {
    const file = makeVideoFile();
    const wrapper = mount(ClipModal, {
      props: { file, libraryId: "lib-1", open: true },
      global: { stubs },
    });

    expect(wrapper.text()).toContain("sample.mp4");
    // Start and end time inputs exist
    const inputs = wrapper.findAll("input");
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it("initializes endTime from file duration", () => {
    const file = makeVideoFile({ duration: 300 });
    const wrapper = mount(ClipModal, {
      props: { file, libraryId: "lib-1", open: true },
      global: { stubs },
    });

    // The formatted time for 300 seconds is "5:00"
    expect(wrapper.text()).toContain("5:00");
  });

  it("initializes endTime to 10 when duration is null", () => {
    const file = makeVideoFile({ duration: null });
    const wrapper = mount(ClipModal, {
      props: { file, libraryId: "lib-1", open: true },
      global: { stubs },
    });

    // 10 seconds => "0:10"
    expect(wrapper.text()).toContain("0:10");
  });

  it("posts clip request to correct endpoint on create", async () => {
    apiFetchMock.mockResolvedValueOnce({ id: "new-clip-id" });

    const file = makeVideoFile({ id: "vid-123", duration: 60 });
    const wrapper = mount(ClipModal, {
      props: { file, libraryId: "lib-1", open: true },
      global: { stubs },
    });

    // Click "Create Clip" button
    const createBtn = wrapper
      .findAll("button")
      .find((b) => b.attributes("data-label") === "Create Clip");
    expect(createBtn?.exists()).toBe(true);
    await createBtn!.trigger("click");

    // Wait for async
    await nextTick();
    await nextTick();

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/libraries/lib-1/files/vid-123/clip",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          startTime: 0,
          endTime: 60,
        }),
      }),
    );
  });

  it("emits 'created' event on successful clip creation", async () => {
    apiFetchMock.mockResolvedValueOnce({ id: "new-clip-id" });

    const file = makeVideoFile({ duration: 60 });
    const wrapper = mount(ClipModal, {
      props: { file, libraryId: "lib-1", open: true },
      global: { stubs },
    });

    const createBtn = wrapper
      .findAll("button")
      .find((b) => b.attributes("data-label") === "Create Clip");
    await createBtn!.trigger("click");

    // Wait for promises to resolve
    await new Promise((r) => setTimeout(r, 10));
    await nextTick();

    expect(wrapper.emitted("created")).toBeTruthy();
  });

  it("shows cancel button that closes modal", () => {
    const file = makeVideoFile();
    const wrapper = mount(ClipModal, {
      props: { file, libraryId: "lib-1", open: true },
      global: { stubs },
    });

    const cancelBtn = wrapper
      .findAll("button")
      .find((b) => b.attributes("data-label") === "Cancel");
    expect(cancelBtn?.exists()).toBe(true);
  });

  it("formats time correctly for display", () => {
    const file = makeVideoFile({ duration: 185 }); // 3:05
    const wrapper = mount(ClipModal, {
      props: { file, libraryId: "lib-1", open: true },
      global: { stubs },
    });

    // End time hint should show "3:05"
    expect(wrapper.text()).toContain("3:05");
  });
});
