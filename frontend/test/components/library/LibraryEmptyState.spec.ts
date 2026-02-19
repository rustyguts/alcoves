import { mount } from "@vue/test-utils";
import LibraryEmptyState from "~/components/library/LibraryEmptyState.vue";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
};

describe("LibraryEmptyState", () => {
  it("renders title and description", () => {
    const wrapper = mount(LibraryEmptyState, {
      props: {
        showTrashed: false,
        title: "No files yet",
        description: "Upload files to get started",
        canManageLibrary: false,
      },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("No files yet");
    expect(wrapper.text()).toContain("Upload files to get started");
  });

  it("shows action buttons when canManageLibrary and not trashed", () => {
    const wrapper = mount(LibraryEmptyState, {
      props: {
        showTrashed: false,
        title: "Empty",
        description: "Nothing here",
        canManageLibrary: true,
      },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Create folder");
    expect(wrapper.text()).toContain("Upload files");
  });

  it("hides action buttons when canManageLibrary is false", () => {
    const wrapper = mount(LibraryEmptyState, {
      props: {
        showTrashed: false,
        title: "Empty",
        description: "Nothing here",
        canManageLibrary: false,
      },
      global: { stubs },
    });
    expect(wrapper.text()).not.toContain("Create folder");
    expect(wrapper.text()).not.toContain("Upload files");
  });

  it("hides action buttons when showTrashed is true", () => {
    const wrapper = mount(LibraryEmptyState, {
      props: {
        showTrashed: true,
        title: "Trash empty",
        description: "No deleted files",
        canManageLibrary: true,
      },
      global: { stubs },
    });
    expect(wrapper.text()).not.toContain("Create folder");
    expect(wrapper.text()).not.toContain("Upload files");
  });

  it("emits createFolder when create folder button is clicked", async () => {
    const wrapper = mount(LibraryEmptyState, {
      props: {
        showTrashed: false,
        title: "Empty",
        description: "Desc",
        canManageLibrary: true,
      },
      global: { stubs },
    });
    const btn = wrapper.findAll("button").find((b) => b.text().includes("Create folder"));
    await btn?.trigger("click");
    expect(wrapper.emitted("createFolder")).toHaveLength(1);
  });

  it("emits uploadFiles when upload button is clicked", async () => {
    const wrapper = mount(LibraryEmptyState, {
      props: {
        showTrashed: false,
        title: "Empty",
        description: "Desc",
        canManageLibrary: true,
      },
      global: { stubs },
    });
    const btn = wrapper.findAll("button").find((b) => b.text().includes("Upload files"));
    await btn?.trigger("click");
    expect(wrapper.emitted("uploadFiles")).toHaveLength(1);
  });
});
