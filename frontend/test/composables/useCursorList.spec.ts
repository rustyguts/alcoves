import { describe, it, expect, beforeEach } from "vitest";
import { ref } from "vue";
import { useCursorList, type CursorListState } from "~/composables/useCursorList";
import { fnStub, type FnStub } from "../support/fn-stub";

interface Entry {
  id: string;
}
interface Page {
  entries: Entry[];
  nextCursor: string | null;
  unreadCount?: number;
}

function makeState(): CursorListState<Entry> {
  return {
    entries: ref<Entry[]>([]),
    nextCursor: ref<string | null>(null),
    loading: ref(false),
    loadingMore: ref(false),
    error: ref<string | null>(null),
  };
}

let fetchPage: FnStub;

beforeEach(() => {
  fetchPage = fnStub();
});

describe("useCursorList.loadFirst", () => {
  it("populates entries + nextCursor and clears loading, firing onPage", async () => {
    const state = makeState();
    const pages: Page[] = [];
    fetchPage.resolve({ entries: [{ id: "1" }, { id: "2" }], nextCursor: "c1", unreadCount: 5 });

    const list = useCursorList<Entry, Page>({
      state,
      fetchPage: fetchPage as unknown as (cursor?: string) => Promise<Page>,
      getId: (e) => e.id,
      onPage: (p) => pages.push(p),
    });

    await list.loadFirst();

    expect(state.entries.value.map((e) => e.id)).toEqual(["1", "2"]);
    expect(state.nextCursor.value).toBe("c1");
    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBeNull();
    expect(pages).toHaveLength(1);
    expect(pages[0]!.unreadCount).toBe(5);
    // First page is fetched with no cursor.
    expect(fetchPage.calls[0]).toEqual([]);
  });

  it("records the error message and leaves entries untouched on failure", async () => {
    const state = makeState();
    state.entries.value = [{ id: "stale" }];
    fetchPage.reject(new Error("boom"));

    const list = useCursorList<Entry, Page>({
      state,
      fetchPage: fetchPage as unknown as (cursor?: string) => Promise<Page>,
      getId: (e) => e.id,
    });

    await list.loadFirst();

    expect(state.error.value).toBe("boom");
    expect(state.loading.value).toBe(false);
    expect(state.entries.value.map((e) => e.id)).toEqual(["stale"]);
  });
});

describe("useCursorList.loadMore", () => {
  it("is a no-op when there is no next cursor", async () => {
    const state = makeState();
    const list = useCursorList<Entry, Page>({
      state,
      fetchPage: fetchPage as unknown as (cursor?: string) => Promise<Page>,
      getId: (e) => e.id,
    });

    await list.loadMore();
    expect(fetchPage.calls).toHaveLength(0);
  });

  it("is a no-op when a load is already in flight", async () => {
    const state = makeState();
    state.nextCursor.value = "c1";
    state.loadingMore.value = true;
    const list = useCursorList<Entry, Page>({
      state,
      fetchPage: fetchPage as unknown as (cursor?: string) => Promise<Page>,
      getId: (e) => e.id,
    });

    await list.loadMore();
    expect(fetchPage.calls).toHaveLength(0);
  });

  it("appends the next page and passes the cursor through", async () => {
    const state = makeState();
    state.entries.value = [{ id: "1" }];
    state.nextCursor.value = "c1";
    fetchPage.resolve({ entries: [{ id: "2" }], nextCursor: null });

    const list = useCursorList<Entry, Page>({
      state,
      fetchPage: fetchPage as unknown as (cursor?: string) => Promise<Page>,
      getId: (e) => e.id,
    });

    await list.loadMore();

    expect(state.entries.value.map((e) => e.id)).toEqual(["1", "2"]);
    expect(state.nextCursor.value).toBeNull();
    expect(state.loadingMore.value).toBe(false);
    expect(fetchPage.calls[0]).toEqual(["c1"]);
  });

  it("records the error and clears loadingMore on failure", async () => {
    const state = makeState();
    state.nextCursor.value = "c1";
    fetchPage.reject(new Error("nope"));

    const list = useCursorList<Entry, Page>({
      state,
      fetchPage: fetchPage as unknown as (cursor?: string) => Promise<Page>,
      getId: (e) => e.id,
    });

    await list.loadMore();
    expect(state.error.value).toBe("nope");
    expect(state.loadingMore.value).toBe(false);
  });
});

describe("useCursorList.prependLive", () => {
  it("prepends a new entry and fires onPrepend", () => {
    const state = makeState();
    state.entries.value = [{ id: "1" }];
    let prepended = 0;
    const list = useCursorList<Entry, Page>({
      state,
      fetchPage: fetchPage as unknown as (cursor?: string) => Promise<Page>,
      getId: (e) => e.id,
      onPrepend: () => prepended++,
    });

    list.prependLive({ id: "2" });

    expect(state.entries.value.map((e) => e.id)).toEqual(["2", "1"]);
    expect(prepended).toBe(1);
  });

  it("ignores a duplicate id and does not fire onPrepend", () => {
    const state = makeState();
    state.entries.value = [{ id: "1" }];
    let prepended = 0;
    const list = useCursorList<Entry, Page>({
      state,
      fetchPage: fetchPage as unknown as (cursor?: string) => Promise<Page>,
      getId: (e) => e.id,
      onPrepend: () => prepended++,
    });

    list.prependLive({ id: "1" });

    expect(state.entries.value.map((e) => e.id)).toEqual(["1"]);
    expect(prepended).toBe(0);
  });
});
