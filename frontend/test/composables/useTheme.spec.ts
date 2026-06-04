import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";

const state = vi.hoisted(() => ({ preference: "system", value: "light" }));

mockNuxtImport("useColorMode", () => {
  return () => state;
});

import { useTheme } from "~/composables/useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    state.preference = "system";
    state.value = "light";
  });

  it("maps a 'system' preference to 'auto'", () => {
    expect(useTheme().preference.value).toBe("auto");
  });

  it("passes through explicit light / dark preferences", () => {
    state.preference = "dark";
    expect(useTheme().preference.value).toBe("dark");
    state.preference = "light";
    expect(useTheme().preference.value).toBe("light");
  });

  it("writes 'auto' back as the underlying 'system' value", () => {
    const { preference } = useTheme();
    preference.value = "auto";
    expect(state.preference).toBe("system");
  });

  it("writes explicit preferences straight through", () => {
    const { preference } = useTheme();
    preference.value = "dark";
    expect(state.preference).toBe("dark");
  });

  it("derives a resolved light/dark theme from colorMode.value", () => {
    expect(useTheme().theme.value).toBe("light");
    state.value = "dark";
    expect(useTheme().theme.value).toBe("dark");
  });
});
