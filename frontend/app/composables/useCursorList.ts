import type { Ref } from "vue";

/** Minimal shape every cursor-paginated endpoint returns. */
export interface CursorPage<E> {
  entries: E[];
  nextCursor: string | null;
}

/** Reactive state the caller owns (plain `ref`s or shared `useState`). */
export interface CursorListState<E> {
  entries: Ref<E[]>;
  nextCursor: Ref<string | null>;
  loading: Ref<boolean>;
  loadingMore: Ref<boolean>;
  error: Ref<string | null>;
}

export interface CursorListOptions<E, P extends CursorPage<E>> {
  state: CursorListState<E>;
  /** Fetch one page; `cursor` is undefined for the first page. */
  fetchPage: (cursor?: string) => Promise<P>;
  /** Stable identity used to dedupe live-pushed entries. */
  getId: (entry: E) => string;
  /** Side effects after each successful page (e.g. syncing an unread count). */
  onPage?: (page: P) => void;
  /** Side effects after a live entry is prepended (e.g. bumping a counter). */
  onPrepend?: (entry: E) => void;
}

export interface CursorListActions<E> {
  loadFirst: () => Promise<void>;
  loadMore: () => Promise<void>;
  prependLive: (entry: E) => void;
}

/**
 * Shared cursor-pagination engine for activity-style feeds. Drives the standard
 * loadFirst / loadMore / prependLive flow over caller-owned reactive state so
 * both the per-library feed (`useLibraryFeed`) and the global notifications bell
 * (`useNotifications`) share one implementation while keeping their own state
 * backing (local `ref` vs shared `useState`) and per-page side effects.
 */
export function useCursorList<E, P extends CursorPage<E>>(
  options: CursorListOptions<E, P>,
): CursorListActions<E> {
  const { state, fetchPage, getId, onPage, onPrepend } = options;

  async function loadFirst() {
    state.loading.value = true;
    state.error.value = null;
    try {
      const resp = await fetchPage();
      state.entries.value = resp.entries;
      state.nextCursor.value = resp.nextCursor;
      onPage?.(resp);
    } catch (e) {
      state.error.value = (e as Error).message;
    } finally {
      state.loading.value = false;
    }
  }

  async function loadMore() {
    if (!state.nextCursor.value || state.loadingMore.value) return;
    state.loadingMore.value = true;
    try {
      const resp = await fetchPage(state.nextCursor.value);
      state.entries.value = state.entries.value.concat(resp.entries);
      state.nextCursor.value = resp.nextCursor;
      onPage?.(resp);
    } catch (e) {
      state.error.value = (e as Error).message;
    } finally {
      state.loadingMore.value = false;
    }
  }

  function prependLive(entry: E) {
    if (state.entries.value.some((existing) => getId(existing) === getId(entry))) return;
    state.entries.value = [entry, ...state.entries.value];
    onPrepend?.(entry);
  }

  return { loadFirst, loadMore, prependLive };
}
