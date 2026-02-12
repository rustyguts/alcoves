import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import { defineComponent } from "vue";
import UploadModal from "~/components/UploadModal.vue";

const { addFilesMock } = vi.hoisted(() => ({
  addFilesMock: vi.fn(),
}));

mockNuxtImport("useUploadQueue", () => {
  return () => ({
    addFiles: addFilesMock,
  });
});

const UModalStub = defineComponent({
  name: "UModal",
  props: {
    open: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:open", "after:leave"],
  template: `
    <div data-testid="modal" :data-open="String(open)">
      <slot name="body" />
      <slot name="footer" />
    </div>
  `,
});

const UFileUploadStub = defineComponent({
  name: "UFileUpload",
  props: {
    modelValue: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["update:modelValue"],
  template: `<div data-testid="u-file-upload" />`,
});

const UButtonStub = defineComponent({
  name: "UButton",
  props: {
    disabled: {
      type: Boolean,
      default: false,
    },
    label: {
      type: String,
      default: "",
    },
  },
  emits: ["click"],
  template: `<button :disabled="disabled" @click="$emit('click')">{{ label }}</button>`,
});

describe("UploadModal", () => {
  beforeEach(() => {
    addFilesMock.mockReset();
  });

  async function mountComponent() {
    return mountSuspended(UploadModal, {
      props: {
        open: true,
        libraryId: "lib-123",
        libraryName: "My Library",
        parentFolderId: "folder-9",
      },
      global: {
        stubs: {
          UModal: UModalStub,
          UFileUpload: UFileUploadStub,
          UButton: UButtonStub,
        },
      },
    });
  }

  it("starts with upload disabled", async () => {
    const wrapper = await mountComponent();
    const uploadButton = wrapper.findAll("button").find((el) => el.text() === "Upload");

    expect(uploadButton?.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Uploading to My Library");
  });

  it("shows selected file count and pluralization", async () => {
    const wrapper = await mountComponent();
    const upload = wrapper.getComponent(UFileUploadStub);

    upload.vm.$emit("update:modelValue", [new File(["a"], "a.txt"), new File(["b"], "b.txt")]);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("2 files selected");
  });

  it("queues selected files and closes modal on upload", async () => {
    const wrapper = await mountComponent();
    const files = [new File(["hello"], "hello.txt")];

    wrapper.getComponent(UFileUploadStub).vm.$emit("update:modelValue", files);
    await wrapper.vm.$nextTick();

    const uploadButton = wrapper.findAll("button").find((el) => el.text() === "Upload");
    expect(uploadButton?.attributes("disabled")).toBeUndefined();

    await uploadButton?.trigger("click");

    expect(addFilesMock).toHaveBeenCalledWith(files, "lib-123", "My Library", "folder-9");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("clears selection after modal leave", async () => {
    const wrapper = await mountComponent();

    wrapper.getComponent(UFileUploadStub).vm.$emit("update:modelValue", [new File(["x"], "x.txt")]);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("1 file selected");

    wrapper.getComponent(UModalStub).vm.$emit("after:leave");
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain("file selected");
  });
});
