import { ref } from "vue";
import { mount } from "@vue/test-utils";
import ToastContainer from "~/components/ToastContainer.vue";

const mocks = vi.hoisted(() => {
  const removeFn = vi.fn();
  return {
    toastsArray: [] as { id: number; title: string; description?: string; color?: string }[],
    remove: removeFn,
  };
});

// Create the ref outside vi.hoisted so Vue is available
const toastsRef = ref(mocks.toastsArray);

vi.mock("~/composables/useToast", () => ({
  useToast: () => ({
    toasts: toastsRef,
    remove: mocks.remove,
  }),
}));

describe("ToastContainer", () => {
  beforeEach(() => {
    toastsRef.value = [];
    mocks.remove.mockReset();
  });

  it("renders no toasts when list is empty", () => {
    const wrapper = mount(ToastContainer, { attachTo: document.body });
    expect(document.body.querySelectorAll(".alert").length).toBe(0);
    wrapper.unmount();
  });

  it("renders toast titles", async () => {
    toastsRef.value = [{ id: 1, title: "File uploaded" }];
    const wrapper = mount(ToastContainer, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    const alerts = document.body.querySelectorAll(".alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain("File uploaded");

    wrapper.unmount();
  });

  it("renders toast description when provided", async () => {
    toastsRef.value = [{ id: 1, title: "Error", description: "Something went wrong" }];
    const wrapper = mount(ToastContainer, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    expect(document.body.textContent).toContain("Something went wrong");

    wrapper.unmount();
  });

  it("applies color class for success", async () => {
    toastsRef.value = [{ id: 1, title: "Done", color: "success" }];
    const wrapper = mount(ToastContainer, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    const alert = document.body.querySelector(".alert");
    expect(alert?.classList.contains("alert-success")).toBe(true);

    wrapper.unmount();
  });

  it("applies color class for error", async () => {
    toastsRef.value = [{ id: 1, title: "Fail", color: "error" }];
    const wrapper = mount(ToastContainer, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    const alert = document.body.querySelector(".alert");
    expect(alert?.classList.contains("alert-error")).toBe(true);

    wrapper.unmount();
  });

  it("applies color class for warning", async () => {
    toastsRef.value = [{ id: 1, title: "Warn", color: "warning" }];
    const wrapper = mount(ToastContainer, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    const alert = document.body.querySelector(".alert");
    expect(alert?.classList.contains("alert-warning")).toBe(true);

    wrapper.unmount();
  });

  it("calls remove when toast is clicked", async () => {
    toastsRef.value = [{ id: 42, title: "Click me" }];
    const wrapper = mount(ToastContainer, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    const alert = document.body.querySelector(".alert") as HTMLElement;
    alert?.click();
    await wrapper.vm.$nextTick();

    expect(mocks.remove).toHaveBeenCalledWith(42);

    wrapper.unmount();
  });

  it("renders multiple toasts", async () => {
    toastsRef.value = [
      { id: 1, title: "First" },
      { id: 2, title: "Second" },
      { id: 3, title: "Third" },
    ];
    const wrapper = mount(ToastContainer, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    const alerts = document.body.querySelectorAll(".alert");
    expect(alerts).toHaveLength(3);

    wrapper.unmount();
  });
});
