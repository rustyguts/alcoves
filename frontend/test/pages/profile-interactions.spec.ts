import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import ProfilePage from "~/pages/profile.vue";

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

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "u@e.com", displayName: "Test User", avatarUrl: null as string | null },
  toast: { add: vi.fn() },
  updateProfile: vi.fn(() => Promise.resolve()),
  uploadAvatar: vi.fn(() => Promise.resolve()),
  apiFetch: vi.fn().mockResolvedValue({}),
  sessions: [] as unknown[],
  refreshSessions: vi.fn(),
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    user: mockRef(() => mocks.user),
    updateProfile: mocks.updateProfile,
    uploadAvatar: mocks.uploadAvatar,
    loggedIn: { value: true },
    fetchSession: vi.fn().mockResolvedValue(null),
  }),
}));
vi.mock("~/composables/useToast", () => ({ useToast: () => mocks.toast }));
vi.mock("~/composables/useTheme", () => ({
  useTheme: () => ({ theme: mockRef(() => "light"), preference: mockRef(() => "auto") }),
}));
vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: () => ({ data: mockRef(() => mocks.sessions), refresh: mocks.refreshSessions }),
}));
vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...a: unknown[]) => mocks.apiFetch(...a),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

const stubs = {
  UIcon: { template: "<i />", props: ["name"] },
  UCard: { template: "<section><slot name='header'/><slot/><slot name='footer'/></section>", props: ["ui"] },
  UAvatar: { template: "<div class='avatar'/>", props: ["src", "alt", "text", "size"] },
  UInput: {
    template: "<input :value='modelValue' :placeholder='placeholder' @input=\"$emit('update:modelValue', $event.target.value)\" />",
    props: ["modelValue", "placeholder", "size", "ui"],
    emits: ["update:modelValue"],
  },
  UButton: { template: "<button :disabled='disabled' @click=\"$emit('click', $event)\"><slot/></button>", props: ["color", "size", "loading", "disabled", "icon"], emits: ["click"] },
  UBadge: { template: "<span><slot/></span>", props: ["color", "variant", "size"] },
  UAlert: { template: "<div>{{ title }}</div>", props: ["color", "variant", "icon", "title", "description"] },
};

function mountPage() {
  return mount(ProfilePage, { global: { stubs } });
}

function selectFile(wrapper: ReturnType<typeof mountPage>, file: File) {
  const input = wrapper.find("input[type='file']");
  Object.defineProperty(input.element, "files", { value: [file], configurable: true });
  return input.trigger("change");
}

const saveBtn = (wrapper: ReturnType<typeof mountPage>) =>
  wrapper.findAll("button").find((b) => b.text().includes("Save"));

beforeEach(() => {
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:preview"),
    revokeObjectURL: vi.fn(),
  });
  mocks.toast.add.mockReset();
  mocks.updateProfile.mockClear();
  mocks.uploadAvatar.mockClear();
  mocks.user.displayName = "Test User";
});

describe("profile.vue interactions", () => {
  it("rejects a non-image avatar selection", async () => {
    const wrapper = mountPage();
    await selectFile(wrapper, new File(["x"], "a.txt", { type: "text/plain" }));
    expect(mocks.toast.add).toHaveBeenCalledWith({
      title: "Please select an image file",
      color: "error",
    });
  });

  it("rejects an oversized avatar selection", async () => {
    const wrapper = mountPage();
    const big = new File([new Uint8Array(1)], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    await selectFile(wrapper, big);
    expect(mocks.toast.add).toHaveBeenCalledWith({
      title: "Avatar image is too large (max 25MB)",
      color: "error",
    });
  });

  it("accepts a valid image, previews it, and enables Save", async () => {
    const wrapper = mountPage();
    await selectFile(wrapper, new File(["x"], "a.png", { type: "image/png" }));
    expect(saveBtn(wrapper)!.attributes("disabled")).toBeUndefined();
  });

  it("uploads the selected avatar on Save", async () => {
    const wrapper = mountPage();
    await selectFile(wrapper, new File(["x"], "a.png", { type: "image/png" }));
    await saveBtn(wrapper)!.trigger("click");
    await vi.waitFor(() => expect(mocks.uploadAvatar).toHaveBeenCalled());
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Profile updated", color: "success" });
  });

  it("updates the display name on Save", async () => {
    const wrapper = mountPage();
    await wrapper.find("input[placeholder='Display name']").setValue("Renamed");
    await saveBtn(wrapper)!.trigger("click");
    await vi.waitFor(() =>
      expect(mocks.updateProfile).toHaveBeenCalledWith({ displayName: "Renamed" }),
    );
  });

  it("surfaces an error toast when saving fails", async () => {
    mocks.uploadAvatar.mockRejectedValueOnce(
      Object.assign(new Error("x"), { data: { statusMessage: "Server says no" } }),
    );
    const wrapper = mountPage();
    await selectFile(wrapper, new File(["x"], "a.png", { type: "image/png" }));
    await saveBtn(wrapper)!.trigger("click");
    await vi.waitFor(() =>
      expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Server says no", color: "error" }),
    );
  });
});
