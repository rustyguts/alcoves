import { mount } from "@vue/test-utils";
import RegisterPage from "~/pages/register.vue";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  mockRouter: { push: vi.fn(), replace: vi.fn() },
  mockRoute: { query: {} } as { query: Record<string, string> },
  providers: vi.fn().mockResolvedValue({ google: false }),
  registrationMode: vi.fn().mockResolvedValue({ mode: "open" }),
  inviteLookup: vi.fn(),
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    register: mocks.register,
    loggedIn: { value: true },
    fetchSession: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRouter: () => mocks.mockRouter,
    useRoute: () => mocks.mockRoute,
    RouterLink: { template: "<a><slot /></a>", props: ["to"] },
  };
});

vi.mock("~/api", () => ({
  api: {
    auth: {
      providers: () => mocks.providers(),
    },
    meta: {
      registrationMode: () => mocks.registrationMode(),
    },
    invites: {
      lookup: (token: string) => mocks.inviteLookup(token),
    },
  },
}));

const stubs = {
  AppIcon: { template: "<svg />", props: ["name", "class"] },
};

async function flushAll() {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("register.vue", () => {
  beforeEach(() => {
    mocks.register.mockReset();
    mocks.mockRouter.push.mockReset();
    mocks.mockRoute.query = {};
    mocks.providers.mockReset().mockResolvedValue({ google: false });
    mocks.registrationMode.mockReset().mockResolvedValue({ mode: "open" });
    mocks.inviteLookup.mockReset();
  });

  async function mountPage() {
    const wrapper = mount(RegisterPage, { global: { stubs } });
    await flushAll();
    return wrapper;
  }

  it("renders register page", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Get started with Alcoves");
  });

  it("shows link to login page", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Sign in");
  });

  it("calls register on form submit", async () => {
    mocks.register.mockResolvedValueOnce({});

    const wrapper = await mountPage();

    const inputs = wrapper.findAll("input");
    const nameInput = inputs.find((i) => i.attributes("type") === "text");
    const emailInput = inputs.find((i) => i.attributes("type") === "email");
    const passwordInputs = inputs.filter((i) => i.attributes("type") === "password");

    await nameInput!.setValue("Test");
    await emailInput!.setValue("test@example.com");
    await passwordInputs[0]!.setValue("password123");
    await passwordInputs[1]!.setValue("password123");

    await wrapper.find("form").trigger("submit");

    await vi.waitFor(() => {
      expect(mocks.register).toHaveBeenCalledWith(
        "Test",
        "test@example.com",
        "password123",
        undefined,
      );
    });
  });

  it("shows error message on register failure", async () => {
    mocks.register.mockRejectedValueOnce({ data: { message: "Email taken" } });

    const wrapper = await mountPage();

    const inputs = wrapper.findAll("input");
    const nameInput = inputs.find((i) => i.attributes("type") === "text");
    const emailInput = inputs.find((i) => i.attributes("type") === "email");
    const passwordInputs = inputs.filter((i) => i.attributes("type") === "password");

    await nameInput!.setValue("Test");
    await emailInput!.setValue("test@example.com");
    await passwordInputs[0]!.setValue("password123");
    await passwordInputs[1]!.setValue("password123");

    await wrapper.find("form").trigger("submit");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Email taken");
    });
  });

  it("shows fallback error message when no data.message", async () => {
    mocks.register.mockRejectedValueOnce(new Error("fail"));

    const wrapper = await mountPage();

    const inputs = wrapper.findAll("input");
    const nameInput = inputs.find((i) => i.attributes("type") === "text");
    const emailInput = inputs.find((i) => i.attributes("type") === "email");
    const passwordInputs = inputs.filter((i) => i.attributes("type") === "password");

    await nameInput!.setValue("Test");
    await emailInput!.setValue("test@example.com");
    await passwordInputs[0]!.setValue("password123");
    await passwordInputs[1]!.setValue("password123");

    await wrapper.find("form").trigger("submit");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Registration failed");
    });
  });

  it("shows disabled message when registration is closed", async () => {
    mocks.registrationMode.mockResolvedValueOnce({ mode: "closed" });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Registration is disabled");
  });

  it("requires invite token in invite_only mode without token", async () => {
    mocks.registrationMode.mockResolvedValueOnce({ mode: "invite_only" });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("invite-only");
  });
});
