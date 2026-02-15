import { mount } from "@vue/test-utils";
import UploadModal from "~/components/UploadModal.vue";

const { addFilesMock } = vi.hoisted(() => ({
  addFilesMock: vi.fn(),
}));

vi.mock("~/composables/useUploadQueue", () => ({
  useUploadQueue: () => ({
    addFiles: addFilesMock,
  }),
}));

const stubs = {
  AppIcon: { template: "<svg />", props: ["name", "class"] },
};

/**
 * Helper: simulate selecting files on a native <input type="file">.
 * jsdom lacks DataTransfer, so we define the `files` property directly.
 */
function setFiles(inputWrapper: ReturnType<typeof mount>["find"] extends (s: string) => infer R ? R : never, files: File[]) {
  const fileList = Object.create(null);
  files.forEach((f, i) => { fileList[i] = f; });
  fileList.length = files.length;
  fileList.item = (i: number) => files[i] ?? null;
  fileList[Symbol.iterator] = function* () { for (const f of files) yield f; };
  Object.defineProperty(inputWrapper.element, "files", { value: fileList, configurable: true });
}

describe("UploadModal", () => {
  beforeEach(() => {
    addFilesMock.mockReset();
  });

  function mountComponent() {
    return mount(UploadModal, {
      props: {
        open: true,
        libraryId: "lib-123",
        libraryName: "My Library",
        parentFolderId: "folder-9",
      },
      global: { stubs },
    });
  }

  it("starts with upload disabled", () => {
    const wrapper = mountComponent();
    const uploadButton = wrapper
      .findAll("button.btn")
      .find((el) => el.text().includes("Upload"));

    expect(uploadButton?.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Uploading to My Library");
  });

  it("shows selected file count and pluralization", async () => {
    const wrapper = mountComponent();
    const fileInput = wrapper.find("input[type='file']");

    setFiles(fileInput, [new File(["a"], "a.txt"), new File(["b"], "b.txt")]);
    await fileInput.trigger("change");
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("2 files selected");
  });

  it("queues selected files and closes modal on upload", async () => {
    const wrapper = mountComponent();
    const fileInput = wrapper.find("input[type='file']");

    const files = [new File(["hello"], "hello.txt")];
    setFiles(fileInput, files);
    await fileInput.trigger("change");
    await wrapper.vm.$nextTick();

    const uploadButton = wrapper
      .findAll("button.btn")
      .find((el) => el.text().includes("Upload"));
    expect(uploadButton?.attributes("disabled")).toBeUndefined();

    await uploadButton?.trigger("click");

    expect(addFilesMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(File)]),
      "lib-123",
      "My Library",
      "folder-9",
    );
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("clears selection when modal closes", async () => {
    const wrapper = mountComponent();
    const fileInput = wrapper.find("input[type='file']");

    setFiles(fileInput, [new File(["x"], "x.txt")]);
    await fileInput.trigger("change");
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("1 file selected");

    // Simulate modal closing by setting open to false
    await wrapper.setProps({ open: false });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain("file selected");
  });
});
