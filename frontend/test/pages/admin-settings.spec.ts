import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import AdminPage from "~/pages/admin/index.vue";

function mockRef<T>(get: () => T, set?: (value: T) => void) {
  return {
    __v_isRef: true as const,
    get value() {
      return get();
    },
    set value(v: T) {
      set?.(v);
    },
  };
}

type Settings = {
  registration_mode: string;
  whisper_model: string;
  whisper_language: string;
  audio_detect_model: string;
};

const mocks = vi.hoisted(() => ({
  settings: {
    registration_mode: "open",
    whisper_model: "large-v3",
    whisper_language: "auto",
    audio_detect_model: "efficientat_mn10",
  } as Settings,
  stats: { users: 1, libraries: 1, files: 1, folders: 1, totalSize: 1024 },
  users: [],
  version: null,
  toast: { add: vi.fn() },
  apiFetch: vi.fn(),
  currentUser: { id: "user-1", role: "owner" },
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: (url: string) => {
    if (url.includes("/admin/stats"))
      return { data: mockRef(() => mocks.stats), status: mockRef(() => "success"), refresh: vi.fn() };
    if (url.includes("/admin/users"))
      return { data: mockRef(() => mocks.users), status: mockRef(() => "success"), refresh: vi.fn() };
    if (url.includes("/admin/settings"))
      return {
        data: mockRef(() => mocks.settings, (v: Settings) => (mocks.settings = v)),
        status: mockRef(() => "success"),
        refresh: vi.fn(),
      };
    return { data: mockRef(() => mocks.version), status: mockRef(() => "idle"), refresh: vi.fn() };
  },
}));

vi.mock("~/composables/useToast", () => ({ useToast: () => mocks.toast }));
vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    user: mockRef(() => mocks.currentUser),
    loggedIn: { value: true },
    fetchSession: vi.fn().mockResolvedValue(null),
  }),
}));
vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...a: unknown[]) => mocks.apiFetch(...a),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

const stubs = {
  AdminJobsPanel: { template: "<div/>" },
  UserAvatar: { template: "<div/>" },
  AppIcon: { template: "<svg/>" },
  AppPanel: { template: "<section><slot name='actions'/><slot/></section>", props: ["title", "description", "icon", "flush", "bodyClass"] },
  AppPanelRow: { template: "<div><slot/><slot name='control'/></div>", props: ["label", "description"] },
};

function mountPage() {
  return mount(AdminPage, { global: { stubs } });
}

beforeEach(() => {
  mocks.settings = {
    registration_mode: "open",
    whisper_model: "large-v3",
    whisper_language: "auto",
    audio_detect_model: "efficientat_mn10",
  };
  mocks.toast.add.mockReset();
  mocks.apiFetch.mockReset().mockResolvedValue({
    registration_mode: "invite_only",
    whisper_model: "tiny",
    whisper_language: "fr",
    audio_detect_model: "ced_small",
  });
});

describe("admin settings handlers", () => {
  it("renders the selected whisper model details", () => {
    const wrapper = mountPage();
    // large-v3 default details should be visible
    expect(wrapper.text()).toContain("Best WER");
  });

  it("updates the registration mode via radio change", async () => {
    const wrapper = mountPage();
    const radio = wrapper.find('input[value="invite_only"]');
    await radio.trigger("change");
    await vi.waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/settings", {
        method: "PATCH",
        body: { registration_mode: "invite_only" },
      });
    });
    expect(mocks.toast.add).toHaveBeenCalledWith({
      title: "Registration mode updated",
      color: "success",
    });
  });

  it("updates the whisper model via the select", async () => {
    const wrapper = mountPage();
    const selects = wrapper.findAll("select");
    await selects[0]!.setValue("tiny");
    await vi.waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/settings", {
        method: "PATCH",
        body: { whisper_model: "tiny" },
      });
    });
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Transcription model: tiny", color: "success" });
  });

  it("updates the whisper language via the select", async () => {
    const wrapper = mountPage();
    const selects = wrapper.findAll("select");
    await selects[1]!.setValue("fr");
    await vi.waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/settings", {
        method: "PATCH",
        body: { whisper_language: "fr" },
      });
    });
  });

  it("updates the audio tagger via the select", async () => {
    const wrapper = mountPage();
    const selects = wrapper.findAll("select");
    await selects[2]!.setValue("ced_small");
    await vi.waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/settings", {
        method: "PATCH",
        body: { audio_detect_model: "ced_small" },
      });
    });
  });

  it("rolls back and toasts on a settings update failure", async () => {
    mocks.apiFetch.mockReset().mockRejectedValue(new Error("server boom"));
    const wrapper = mountPage();
    await wrapper.find('input[value="closed"]').trigger("change");
    await vi.waitFor(() => {
      expect(mocks.toast.add).toHaveBeenCalledWith({ title: "server boom", color: "error" });
    });
  });
});
