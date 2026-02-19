import { ref, watch, isRef, toValue, type Ref, type WatchSource, type MaybeRefOrGetter } from "vue";
import { apiFetch, type ApiFetchOptions } from "~/utils/api-fetch";

interface UseApiFetchReturn<T> {
  data: Ref<T | null>;
  error: Ref<unknown>;
  status: Ref<"idle" | "pending" | "success" | "error">;
  refresh: () => Promise<void>;
  execute: () => Promise<void>;
}

interface UseApiFetchOptions extends Omit<ApiFetchOptions, "query"> {
  immediate?: boolean;
  query?: MaybeRefOrGetter<Record<string, string | undefined>> | Record<string, string | undefined>;
  default?: () => unknown;
}

export function useApiFetch<T = unknown>(
  url: MaybeRefOrGetter<string>,
  options: UseApiFetchOptions = {},
): UseApiFetchReturn<T> {
  const { immediate = true, default: defaultFn, ...fetchOptions } = options;

  const data = ref<T | null>((defaultFn?.() as T) ?? null) as Ref<T | null>;
  const error = ref<unknown>(null);
  const status = ref<"idle" | "pending" | "success" | "error">("idle");

  async function execute() {
    status.value = "pending";
    error.value = null;
    try {
      const resolvedUrl = toValue(url);
      const resolvedQuery = options.query ? toValue(options.query) : undefined;
      const result = await apiFetch<T>(resolvedUrl, {
        ...fetchOptions,
        query: resolvedQuery as Record<string, string | undefined> | undefined,
      });
      data.value = result;
      status.value = "success";
    } catch (err) {
      error.value = err;
      status.value = "error";
    }
  }

  // Watch reactive URL for changes
  const urlSource: WatchSource | null =
    typeof url === "function" ? (url as () => string) : isRef(url) ? url : null;

  if (urlSource) {
    watch(urlSource, () => {
      execute();
    });
  }

  if (immediate) {
    execute();
  }

  return { data, error, status, refresh: execute, execute };
}
