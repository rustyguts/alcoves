import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { fnStub } from "../support/fn-stub";
import {
  useHighlightFilters,
  useHighlightMatches,
  HIGHLIGHT_PRESETS,
} from "~/composables/useHighlightFilters";
import type { AudioDetection, HighlightFilter } from "~~/shared/types/api";

const list = fnStub();
const create = fnStub();
const update = fnStub();
const remove = fnStub();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: () => Promise.resolve(),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: {
    highlightFilters: {
      list: (...a: unknown[]) => list(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
      remove: (...a: unknown[]) => remove(...a),
    },
  },
}));

function makeFilter(over: Partial<HighlightFilter>): HighlightFilter {
  return {
    id: "f1",
    libraryId: "lib1",
    createdById: null,
    name: "Filter",
    expression: "",
    proximitySeconds: 0,
    color: "#fff",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function makeDetection(over: Partial<AudioDetection>): AudioDetection {
  return {
    id: "d",
    fileId: "f",
    libraryId: "lib1",
    label: "Laughter",
    classIndex: 0,
    score: 0.5,
    startSeconds: 0,
    endSeconds: 1,
    version: 1,
    createdAt: "",
    ...over,
  };
}

describe("HIGHLIGHT_PRESETS", () => {
  it("ships a non-empty preset list", () => {
    expect(HIGHLIGHT_PRESETS.length).toBe(7);
    expect(HIGHLIGHT_PRESETS.every((p) => p.name && p.expression && p.color)).toBe(true);
  });
});

describe("useHighlightFilters (CRUD)", () => {
  beforeEach(() => {
    [list, create, update, remove].forEach((s) => s.reset());
  });

  it("refresh() short-circuits when libraryId is empty", async () => {
    const { refresh, loading } = useHighlightFilters(ref(""));
    await refresh();
    expect(list.calls).toHaveLength(0);
    expect(loading.value).toBe(false);
  });

  it("refresh() loads filters and toggles loading", async () => {
    const rows = [makeFilter({ id: "a" }), makeFilter({ id: "b" })];
    list.resolve(rows);
    const { refresh, filters, loading, error } = useHighlightFilters(ref("lib1"));
    await refresh();
    expect(list.calls[0]).toEqual(["lib1"]);
    expect(filters.value).toEqual(rows);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it("refresh() defaults to [] when the API returns nullish", async () => {
    list.resolve(null);
    const { refresh, filters } = useHighlightFilters(ref("lib1"));
    await refresh();
    expect(filters.value).toEqual([]);
  });

  it("refresh() captures errors", async () => {
    list.reject(new Error("nope"));
    const { refresh, error, loading } = useHighlightFilters(ref("lib1"));
    await refresh();
    expect(error.value).toBeInstanceOf(Error);
    expect(loading.value).toBe(false);
  });

  it("create() appends the created filter", async () => {
    const created = makeFilter({ id: "new" });
    create.resolve(created);
    const { create: doCreate, filters } = useHighlightFilters(ref("lib1"));
    const result = await doCreate({ name: "New", expression: "laughter", color: "#000" });
    expect(create.calls[0]).toEqual(["lib1", { name: "New", expression: "laughter", color: "#000" }]);
    expect(result).toEqual(created);
    expect(filters.value).toEqual([created]);
  });

  it("update() replaces the matching filter", async () => {
    list.resolve([makeFilter({ id: "a", name: "old" }), makeFilter({ id: "b" })]);
    const updated = makeFilter({ id: "a", name: "new" });
    update.resolve(updated);
    const { refresh, update: doUpdate, filters } = useHighlightFilters(ref("lib1"));
    await refresh();
    await doUpdate("a", { name: "new" });
    expect(update.calls[0]).toEqual(["lib1", "a", { name: "new" }]);
    expect(filters.value.find((f) => f.id === "a")!.name).toBe("new");
  });

  it("remove() drops the deleted filter", async () => {
    list.resolve([makeFilter({ id: "a" }), makeFilter({ id: "b" })]);
    const { refresh, remove: doRemove, filters } = useHighlightFilters(ref("lib1"));
    await refresh();
    await doRemove("a");
    expect(remove.calls[0]).toEqual(["lib1", "a"]);
    expect(filters.value.map((f) => f.id)).toEqual(["b"]);
  });

  it("loadPresets() creates every preset and ignores individual failures", async () => {
    let n = 0;
    create.impl(() => {
      n += 1;
      if (n === 2) return Promise.reject(new Error("dupe"));
      return Promise.resolve(makeFilter({ id: `p${n}` }));
    });
    const { loadPresets, filters } = useHighlightFilters(ref("lib1"));
    await loadPresets();
    expect(create.calls).toHaveLength(HIGHLIGHT_PRESETS.length);
    // 7 attempted, 1 failed → 6 appended
    expect(filters.value).toHaveLength(HIGHLIGHT_PRESETS.length - 1);
  });
});

describe("useHighlightMatches (engine)", () => {
  it("derives cues from the transcript VTT", () => {
    const vtt = ref<string | null>("WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nyo bro");
    const { cues } = useHighlightMatches(ref([]), ref([]), vtt);
    expect(cues.value).toEqual([{ startSeconds: 3, endSeconds: 4, text: "yo bro" }]);
  });

  it("matches a single audio term above its threshold", () => {
    const filters = ref([makeFilter({ id: "fa", expression: "laughter:25" })]);
    const dets = ref([makeDetection({ label: "Laughter", score: 0.5, startSeconds: 1, endSeconds: 2 })]);
    const { matches, aggregates } = useHighlightMatches(filters, dets, ref(null));
    expect(matches.value.fa).toEqual([
      { filterId: "fa", startSeconds: 1, endSeconds: 2, score: 0.5, evidence: ["Laughter"] },
    ]);
    expect(aggregates.value.fa).toEqual({
      count: 1,
      meanScore: 0.5,
      maxScore: 0.5,
      expressionErrors: [],
    });
  });

  it("excludes audio detections below the term threshold", () => {
    const filters = ref([makeFilter({ id: "fa", expression: "laughter:25" })]);
    const dets = ref([makeDetection({ label: "Laughter", score: 0.1 })]);
    const { matches, aggregates } = useHighlightMatches(filters, dets, ref(null));
    expect(matches.value.fa).toEqual([]);
    expect(aggregates.value.fa.count).toBe(0);
  });

  it("matches a word term against transcript cues", () => {
    const filters = ref([makeFilter({ id: "fw", expression: "word:bro" })]);
    const vtt = ref<string | null>("WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nyo bro");
    const { matches } = useHighlightMatches(filters, ref([]), vtt);
    expect(matches.value.fw).toEqual([
      { filterId: "fw", startSeconds: 3, endSeconds: 4, score: 1, evidence: ["yo bro"] },
    ]);
  });

  it("matches an AND group when terms fall within the proximity window", () => {
    const filters = ref([makeFilter({ id: "fand", expression: "laughter & word:bro", proximitySeconds: 5 })]);
    const dets = ref([makeDetection({ label: "Laughter", score: 0.6, startSeconds: 10, endSeconds: 12 })]);
    const vtt = ref<string | null>("WEBVTT\n\n00:00:13.000 --> 00:00:14.000\nhey bro");
    const { matches } = useHighlightMatches(filters, dets, vtt);
    expect(matches.value.fand).toEqual([
      {
        filterId: "fand",
        startSeconds: 10,
        endSeconds: 14,
        score: (0.6 + 1) / 2,
        evidence: ["Laughter", "hey bro"],
      },
    ]);
  });

  it("drops an AND group when partners are outside the proximity window", () => {
    const filters = ref([makeFilter({ id: "fand", expression: "laughter & word:bro", proximitySeconds: 1 })]);
    const dets = ref([makeDetection({ label: "Laughter", score: 0.6, startSeconds: 10, endSeconds: 12 })]);
    const vtt = ref<string | null>("WEBVTT\n\n00:00:13.000 --> 00:00:14.000\nhey bro");
    const { matches } = useHighlightMatches(filters, dets, vtt);
    expect(matches.value.fand).toEqual([]);
  });

  it("drops an AND group when one term has no hits at all", () => {
    const filters = ref([makeFilter({ id: "fand", expression: "laughter & word:zzz", proximitySeconds: 5 })]);
    const dets = ref([makeDetection({ label: "Laughter", score: 0.6 })]);
    const { matches } = useHighlightMatches(filters, dets, ref(null));
    expect(matches.value.fand).toEqual([]);
  });

  it("returns empty results and no errors for a blank expression", () => {
    const filters = ref([makeFilter({ id: "fe", expression: "" })]);
    const { matches, aggregates } = useHighlightMatches(filters, ref([]), ref(null));
    expect(matches.value.fe).toEqual([]);
    expect(aggregates.value.fe).toEqual({ count: 0, meanScore: 0, maxScore: 0, expressionErrors: [] });
  });

  it("surfaces parser errors through the aggregate", () => {
    const filters = ref([makeFilter({ id: "ferr", expression: ":30" })]);
    const { matches, aggregates } = useHighlightMatches(filters, ref([]), ref(null));
    expect(matches.value.ferr).toEqual([]);
    expect(aggregates.value.ferr.expressionErrors.length).toBeGreaterThan(0);
  });

  it("dedupes identical matches across OR groups and aggregates mean/max", () => {
    const filters = ref([makeFilter({ id: "fd", expression: "laughter:25, laughter:25" })]);
    const dets = ref([
      makeDetection({ id: "d1", label: "Laughter", score: 0.4, startSeconds: 1, endSeconds: 2 }),
      makeDetection({ id: "d2", label: "Laughter", score: 0.8, startSeconds: 5, endSeconds: 6 }),
    ]);
    const { matches, aggregates } = useHighlightMatches(filters, dets, ref(null));
    // two distinct detections, deduped across the duplicated OR group
    expect(matches.value.fd).toHaveLength(2);
    expect(matches.value.fd.map((m) => m.startSeconds)).toEqual([1, 5]);
    expect(aggregates.value.fd.count).toBe(2);
    expect(aggregates.value.fd.maxScore).toBe(0.8);
    expect(aggregates.value.fd.meanScore).toBeCloseTo((0.4 + 0.8) / 2);
  });
});
