import { describe, it, expect, vi } from "vitest";
import { useToast } from "~/composables/useToast";

const nuxtUiAdd = vi.fn();
const nuxtUiRemove = vi.fn();
const nuxtUiClear = vi.fn();
vi.mock("@nuxt/ui/composables/useToast", () => ({
  useToast: () => ({ add: nuxtUiAdd, remove: nuxtUiRemove, clear: nuxtUiClear, toasts: [] }),
}));

describe("useToast", () => {
  it("forwards add() with title + description + color", () => {
    nuxtUiAdd.mockReset();
    const t = useToast();
    t.add({ title: "Saved", description: "All good", color: "success" });
    expect(nuxtUiAdd).toHaveBeenCalledWith({
      title: "Saved",
      description: "All good",
      color: "success",
    });
  });

  it("defaults color to neutral when caller omits it", () => {
    nuxtUiAdd.mockReset();
    const t = useToast();
    t.add({ title: "Hi" });
    expect(nuxtUiAdd).toHaveBeenCalledWith({
      title: "Hi",
      description: undefined,
      color: "neutral",
    });
  });

  it("coerces remove() id to string before forwarding", () => {
    nuxtUiRemove.mockReset();
    useToast().remove(42);
    expect(nuxtUiRemove).toHaveBeenCalledWith("42");
  });

  it("forwards clear()", () => {
    nuxtUiClear.mockReset();
    useToast().clear();
    expect(nuxtUiClear).toHaveBeenCalledTimes(1);
  });
});
