import type { MaybeRefOrGetter, Ref, WatchSource } from "vue";
import { apiFetch, type ApiFetchOptions } from "~/utils/api-fetch";

interface UseApiFetchOptions extends Omit<ApiFetchOptions, "query"> {
  immediate?: boolean;
  query?: MaybeRefOrGetter<Record<string, string | undefined>> | Record<string, string | undefined>;
  default?: () => unknown;
  key?: string;
  watch?: WatchSource[] | false;
  server?: boolean;
  lazy?: boolean;
}

export interface UseApiFetchReturn<T> {
  data: Ref<T | null>;
  error: Ref<unknown>;
  status: Ref<"idle" | "pending" | "success" | "error">;
  refresh: () => Promise<void>;
  execute: () => Promise<void>;
}

export function useApiFetch<T = unknown>(
  url: MaybeRefOrGetter<string>,
  options: UseApiFetchOptions = {},
): UseApiFetchReturn<T> {
  const {
    immediate = true,
    default: defaultFn,
    key,
    watch: watchSources,
    server,
    lazy,
    ...fetchOptions
  } = options;
  const urlRef = computed(() => toValue(url));
  const asyncKey = key ?? `api:${urlRef.value}`;

  const asyncOpts: Record<string, unknown> = {
    immediate,
    default: (defaultFn as (() => T | null) | undefined) ?? (() => null),
    server: server ?? true,
    lazy: lazy ?? false,
  };
  if (watchSources === false) {
    asyncOpts.watch = false;
  } else {
    asyncOpts.watch = watchSources ?? [urlRef];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = (useAsyncData as any)(
    asyncKey,
    async () => {
      const resolvedQuery = options.query ? toValue(options.query) : undefined;
      return (await apiFetch<T>(urlRef.value, {
        ...fetchOptions,
        query: resolvedQuery as Record<string, string | undefined> | undefined,
      })) as T | null;
    },
    asyncOpts,
  );

  return {
    data: res.data as Ref<T | null>,
    error: res.error as Ref<unknown>,
    status: res.status as Ref<"idle" | "pending" | "success" | "error">,
    refresh: res.refresh as () => Promise<void>,
    execute: res.execute as () => Promise<void>,
  };
}
