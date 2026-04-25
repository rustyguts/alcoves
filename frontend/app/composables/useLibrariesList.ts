let _refresh: (() => Promise<void>) | null = null;

export function useLibrariesList() {
  function register(fn: () => Promise<void>) {
    _refresh = fn;
  }

  async function refreshLibraries() {
    await _refresh?.();
  }

  return { register, refreshLibraries };
}
