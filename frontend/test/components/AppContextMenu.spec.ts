import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import AppContextMenu from "~/components/AppContextMenu.vue";

/**
 * The component's watcher is async (it awaits nextTick internally),
 * so we need multiple flushes after prop changes for the
 * adjustedPosition ref to be set and v-if to render.
 *
 * The watcher is NOT immediate, so we must mount closed then open
 * via setProps to trigger it.
 */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await nextTick();
  }
}

function mountMenu(slots: Record<string, string> = {}) {
  return mount(AppContextMenu, {
    props: {
      open: false,
      position: null,
    },
    slots: { default: "<ul>Menu</ul>", ...slots },
    global: {
      stubs: {
        Teleport: true,
      },
    },
  });
}

async function mountOpen(position = { x: 100, y: 200 }, slots: Record<string, string> = {}) {
  const wrapper = mountMenu(slots);
  await wrapper.setProps({ open: true, position });
  await settle();
  return wrapper;
}

describe("AppContextMenu", () => {
  it("does not render overlay when open is false", async () => {
    const wrapper = mountMenu();
    await settle();
    expect(wrapper.find(".fixed").exists()).toBe(false);
  });

  it("does not render overlay when position is null", async () => {
    const wrapper = mountMenu();
    await wrapper.setProps({ open: true, position: null });
    await settle();
    expect(wrapper.find(".fixed").exists()).toBe(false);
  });

  it("renders overlay and panel when open with valid position", async () => {
    const wrapper = await mountOpen();
    expect(wrapper.find(".fixed.inset-0").exists()).toBe(true);
    expect(wrapper.find(".dropdown").exists()).toBe(true);
  });

  it("positions panel using inline styles", async () => {
    const wrapper = await mountOpen({ x: 50, y: 75 });
    const panel = wrapper.find(".dropdown");
    expect(panel.exists()).toBe(true);
    expect(panel.attributes("style")).toContain("left:");
    expect(panel.attributes("style")).toContain("top:");
  });

  it("emits close when overlay background is clicked", async () => {
    const wrapper = await mountOpen();
    await wrapper.find(".fixed.inset-0").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("emits close on contextmenu on overlay", async () => {
    const wrapper = await mountOpen();
    await wrapper.find(".fixed.inset-0").trigger("contextmenu");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("does not emit close when clicking inside the panel", async () => {
    const wrapper = await mountOpen();
    await wrapper.find(".dropdown").trigger("click");
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("renders slot content inside the dropdown panel", async () => {
    const wrapper = await mountOpen(
      { x: 10, y: 10 },
      {
        default: "<span class='my-menu'>Items</span>",
      },
    );
    expect(wrapper.find(".my-menu").exists()).toBe(true);
    expect(wrapper.text()).toContain("Items");
  });

  it("clears content when open becomes false", async () => {
    const wrapper = await mountOpen();
    expect(wrapper.find(".fixed").exists()).toBe(true);

    await wrapper.setProps({ open: false });
    await settle();
    expect(wrapper.find(".fixed").exists()).toBe(false);
  });

  it("cleans up resize listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const wrapper = mountMenu();
    wrapper.unmount();
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("registers resize listener on mount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const wrapper = mountMenu();
    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    wrapper.unmount();
  });
});
