/**
 * A call-recording function stub that is NOT a `vi.fn()`.
 *
 * Under the bun + vitest runtime, a `vi.fn()` whose implementation rejects or
 * throws surfaces that error to the test reporter even when the caller catches
 * it (tinyspy tracks thrown results). Composables that own a real `watch` and
 * swallow API errors in a try/catch therefore can't be exercised with a
 * `vi.fn()` mock for their error paths. This stub records calls in a plain
 * array and returns a settable promise, so caught rejections stay caught.
 */
export interface FnStub {
  (...args: unknown[]): unknown;
  /** Recorded positional args, one entry per call. */
  calls: unknown[][];
  /** Make the next (and subsequent) calls resolve to `value`. */
  resolve(value: unknown): void;
  /** Make the next (and subsequent) calls reject with `err`. */
  reject(err: unknown): void;
  /** Install an arbitrary implementation. */
  impl(fn: (...args: unknown[]) => unknown): void;
  /** Clear recorded calls and reset to resolving `undefined`. */
  reset(): void;
}

export function fnStub(): FnStub {
  const calls: unknown[][] = [];
  let next: (...args: unknown[]) => unknown = () => Promise.resolve(undefined);
  const f = ((...args: unknown[]) => {
    calls.push(args);
    return next(...args);
  }) as FnStub;
  f.calls = calls;
  f.resolve = (value) => {
    next = () => Promise.resolve(value);
  };
  f.reject = (err) => {
    next = () => Promise.reject(err);
  };
  f.impl = (fn) => {
    next = fn;
  };
  f.reset = () => {
    calls.length = 0;
    next = () => Promise.resolve(undefined);
  };
  return f;
}
