import { mount, flushPromises } from "@vue/test-utils";
import AccessTokensSection from "~/components/profile/AccessTokensSection.vue";

function mockRef<T>(get: () => T) {
  return {
    __v_isRef: true as const,
    get value() {
      return get();
    },
  };
}

const mocks = vi.hoisted(() => ({
  tokens: [] as Array<{
    id: string;
    name: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
  }>,
  refresh: vi.fn(),
  toast: { add: vi.fn() },
  createToken: vi.fn(),
  revokeToken: vi.fn(),
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: () => ({ data: mockRef(() => mocks.tokens), refresh: mocks.refresh }),
}));

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("~/api", () => ({
  api: {
    auth: {
      createToken: (...args: unknown[]) => mocks.createToken(...args),
      revokeToken: (...args: unknown[]) => mocks.revokeToken(...args),
    },
  },
}));

describe("AccessTokensSection.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokens = [
      {
        id: "t1",
        name: "laptop",
        lastUsedAt: null,
        expiresAt: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    mocks.createToken.mockResolvedValue({
      id: "new",
      name: "ci",
      token: "alc_pat_SECRETVALUE",
      lastUsedAt: null,
      expiresAt: null,
      createdAt: "2026-06-01T00:00:00Z",
    });
    mocks.revokeToken.mockResolvedValue(undefined);
  });

  it("renders existing tokens with a count badge", () => {
    const wrapper = mount(AccessTokensSection);
    expect(wrapper.text()).toContain("MCP access tokens");
    expect(wrapper.text()).toContain("laptop");
    expect(wrapper.text()).toContain("1 active");
  });

  it("shows an empty state when there are no tokens", () => {
    mocks.tokens = [];
    const wrapper = mount(AccessTokensSection);
    expect(wrapper.text()).toContain("No access tokens yet");
  });

  it("creates a token and reveals the plaintext once", async () => {
    const wrapper = mount(AccessTokensSection);
    await wrapper.find('input[placeholder="e.g. Claude Desktop on laptop"]').setValue("ci");

    const createBtn = wrapper.findAll("button").find((b) => b.text().includes("Create token"));
    await createBtn!.trigger("click");
    await flushPromises();

    expect(mocks.createToken).toHaveBeenCalledWith({ name: "ci", expiresInDays: null });
    expect(mocks.refresh).toHaveBeenCalled();
    // The show-once modal renders the plaintext token.
    expect(wrapper.find(".u-modal").exists()).toBe(true);
    const modalInput = wrapper.find(".u-modal input");
    expect((modalInput.element as HTMLInputElement).value).toBe("alc_pat_SECRETVALUE");
  });

  it("requires a name before creating", async () => {
    const wrapper = mount(AccessTokensSection);
    const createBtn = wrapper.findAll("button").find((b) => b.text().includes("Create token"));
    await createBtn!.trigger("click");
    await flushPromises();
    expect(mocks.createToken).not.toHaveBeenCalled();
    expect(mocks.toast.add).toHaveBeenCalledWith(expect.objectContaining({ color: "error" }));
  });

  it("revokes a token", async () => {
    const wrapper = mount(AccessTokensSection);
    const revokeBtn = wrapper.findAll("button").find((b) => b.text().includes("Revoke"));
    await revokeBtn!.trigger("click");
    await flushPromises();
    expect(mocks.revokeToken).toHaveBeenCalledWith("t1");
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
