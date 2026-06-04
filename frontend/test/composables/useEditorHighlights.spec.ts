import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { fnStub } from "../support/fn-stub";
import type { AudioDetection } from "~~/shared/types/api";

const createStub = fnStub();
const updateStub = fnStub();
const removeStub = fnStub();
const loadPresetsStub = fnStub();
const refreshStub = fnStub();
const filtersRef = ref<unknown[]>([]);
const loadingRef = ref(false);
const toastAdd = vi.fn();

vi.mock("~/composables/useToast", () => ({ useToast: () => ({ add: toastAdd }) }));

vi.mock("~/composables/useHighlightFilters", () => ({
  useHighlightFilters: () => ({
    filters: filtersRef,
    loading: loadingRef,
    refresh: (...a: unknown[]) => refreshStub(...a),
    create: (...a: unknown[]) => createStub(...a),
    update: (...a: unknown[]) => updateStub(...a),
    remove: (...a: unknown[]) => removeStub(...a),
    loadPresets: (...a: unknown[]) => loadPresetsStub(...a),
  }),
  useHighlightMatches: () => ({
    cues: ref([]),
    matches: ref({ f1: [] }),
    aggregates: ref({ f1: { count: 0 } }),
  }),
}));

import { useEditorHighlights } from "~/composables/useEditorHighlights";

const makeDetection = (over: Partial<AudioDetection> = {}): AudioDetection =>
  ({ id: "d", label: "x", score: 0.5, startSeconds: 0, endSeconds: 1, ...over } as AudioDetection);

describe("useEditorHighlights", () => {
  beforeEach(() => {
    [createStub, updateStub, removeStub, loadPresetsStub, refreshStub].forEach((s) => s.reset());
    toastAdd.mockReset();
    filtersRef.value = [];
  });

  it("refreshes on construction and re-exports filters/loading/matches/aggregates", () => {
    const h = useEditorHighlights(ref("lib1"), ref([]), ref(null));
    expect(refreshStub.calls.length).toBeGreaterThan(0);
    expect(h.filters).toBe(filtersRef);
    expect(h.loading).toBe(loadingRef);
    expect(h.matches.value).toEqual({ f1: [] });
    expect(h.aggregates.value).toEqual({ f1: { count: 0 } });
  });

  it("hasSignals is true when there are audio detections", () => {
    const h = useEditorHighlights(ref("lib1"), ref([makeDetection()]), ref(null));
    expect(h.hasSignals.value).toBe(true);
  });

  it("hasSignals is true when there is a transcript", () => {
    const h = useEditorHighlights(ref("lib1"), ref([]), ref("WEBVTT\n..."));
    expect(h.hasSignals.value).toBe(true);
  });

  it("hasSignals is false with neither signal", () => {
    const h = useEditorHighlights(ref("lib1"), ref([]), ref(null));
    expect(h.hasSignals.value).toBe(false);
  });

  it("onCreate toasts success and forwards the body", async () => {
    createStub.resolve({ id: "new" });
    const h = useEditorHighlights(ref("lib1"), ref([]), ref(null));
    await h.onCreate({ name: "Laughs", expression: "laughter", color: "#fff" });
    expect(createStub.calls[0]).toEqual([{ name: "Laughs", expression: "laughter", color: "#fff" }]);
    expect(toastAdd).toHaveBeenCalledWith({ title: 'Filter "Laughs" added', color: "success" });
  });

  it("onCreate toasts an error on failure", async () => {
    createStub.reject(new Error("x"));
    const h = useEditorHighlights(ref("lib1"), ref([]), ref(null));
    await h.onCreate({ name: "Laughs", expression: "laughter", color: "#fff" });
    expect(toastAdd).toHaveBeenCalledWith({ title: "Failed to add filter", color: "error" });
  });

  it("onUpdate is silent on success and toasts on failure", async () => {
    updateStub.resolve({ id: "a" });
    const h = useEditorHighlights(ref("lib1"), ref([]), ref(null));
    await h.onUpdate("a", { name: "n" });
    expect(updateStub.calls[0]).toEqual(["a", { name: "n" }]);
    expect(toastAdd).not.toHaveBeenCalled();

    updateStub.reject(new Error("x"));
    await h.onUpdate("a", { name: "n" });
    expect(toastAdd).toHaveBeenCalledWith({ title: "Failed to update filter", color: "error" });
  });

  it("onRemove is silent on success and toasts on failure", async () => {
    removeStub.resolve(undefined);
    const h = useEditorHighlights(ref("lib1"), ref([]), ref(null));
    await h.onRemove("a");
    expect(removeStub.calls[0]).toEqual(["a"]);
    expect(toastAdd).not.toHaveBeenCalled();

    removeStub.reject(new Error("x"));
    await h.onRemove("a");
    expect(toastAdd).toHaveBeenCalledWith({ title: "Failed to delete filter", color: "error" });
  });

  it("onLoadPresets toasts success then error", async () => {
    loadPresetsStub.resolve(undefined);
    const h = useEditorHighlights(ref("lib1"), ref([]), ref(null));
    await h.onLoadPresets();
    expect(toastAdd).toHaveBeenCalledWith({ title: "Presets loaded", color: "success" });

    loadPresetsStub.reject(new Error("x"));
    await h.onLoadPresets();
    expect(toastAdd).toHaveBeenCalledWith({ title: "Failed to load presets", color: "error" });
  });
});
