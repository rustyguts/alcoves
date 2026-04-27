import { describe, it, expect, vi } from "vitest";
import { ref, defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { useEditorShortcuts } from "~/composables/useEditorShortcuts";

function makeHost(handlers: {
  hasSelection: ReturnType<typeof ref<boolean>>;
  onSetStart: () => void;
  onSetEnd: () => void;
  onCreate: () => void;
  onTogglePlay: () => void;
}) {
  return defineComponent({
    setup() {
      useEditorShortcuts(handlers);
      return () => h("div");
    },
  });
}

function fire(key: string, opts: { target?: HTMLElement } = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  if (opts.target) {
    Object.defineProperty(event, "target", { value: opts.target });
  }
  window.dispatchEvent(event);
  return event;
}

describe("useEditorShortcuts", () => {
  it("I/O set in/out only when something is selected", () => {
    const handlers = {
      hasSelection: ref(false),
      onSetStart: vi.fn(),
      onSetEnd: vi.fn(),
      onCreate: vi.fn(),
      onTogglePlay: vi.fn(),
    };
    const Host = makeHost(handlers);
    mount(Host);

    fire("i");
    fire("o");
    expect(handlers.onSetStart).not.toHaveBeenCalled();
    expect(handlers.onSetEnd).not.toHaveBeenCalled();

    handlers.hasSelection.value = true;
    fire("i");
    fire("O");
    expect(handlers.onSetStart).toHaveBeenCalledTimes(1);
    expect(handlers.onSetEnd).toHaveBeenCalledTimes(1);
  });

  it("M creates regardless of selection", () => {
    const handlers = {
      hasSelection: ref(false),
      onSetStart: vi.fn(),
      onSetEnd: vi.fn(),
      onCreate: vi.fn(),
      onTogglePlay: vi.fn(),
    };
    mount(makeHost(handlers));
    fire("m");
    expect(handlers.onCreate).toHaveBeenCalledTimes(1);
  });

  it("Space toggles playback", () => {
    const handlers = {
      hasSelection: ref(false),
      onSetStart: vi.fn(),
      onSetEnd: vi.fn(),
      onCreate: vi.fn(),
      onTogglePlay: vi.fn(),
    };
    mount(makeHost(handlers));
    fire(" ");
    expect(handlers.onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("ignores keypresses fired from text inputs", () => {
    const handlers = {
      hasSelection: ref(true),
      onSetStart: vi.fn(),
      onSetEnd: vi.fn(),
      onCreate: vi.fn(),
      onTogglePlay: vi.fn(),
    };
    mount(makeHost(handlers));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fire("i", { target: input });
    fire("m", { target: input });
    fire(" ", { target: input });
    expect(handlers.onSetStart).not.toHaveBeenCalled();
    expect(handlers.onCreate).not.toHaveBeenCalled();
    expect(handlers.onTogglePlay).not.toHaveBeenCalled();
  });

  it("unbinds the listener on unmount", () => {
    const handlers = {
      hasSelection: ref(true),
      onSetStart: vi.fn(),
      onSetEnd: vi.fn(),
      onCreate: vi.fn(),
      onTogglePlay: vi.fn(),
    };
    const wrapper = mount(makeHost(handlers));
    wrapper.unmount();
    fire("m");
    expect(handlers.onCreate).not.toHaveBeenCalled();
  });
});
