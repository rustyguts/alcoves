import { mount } from "@vue/test-utils";
import LoginPage from "~/pages/login.vue";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  mockRouter: { push: vi.fn(), replace: vi.fn() },
  mockRoute: { query: {} } as { query: Record<string, string> },
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    login: mocks.login,
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

const stubs = {
  AppIcon: { template: "<svg />", props: ["name", "class"] },
};

describe("login.vue", () => {
  beforeEach(() => {
    mocks.login.mockReset();
    mocks.mockRouter.push.mockReset();
    mocks.mockRoute.query = {};
  });

  function mountPage() {
    return mount(LoginPage, { global: { stubs } });
  }

  it("renders login page", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Sign in to your account");
  });

  it("shows link to register page", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Sign up");
  });

  it("calls login on form submit", async () => {
    mocks.login.mockResolvedValueOnce({});

    const wrapper = mountPage();

    // Fill in the form fields
    const emailInput = wrapper.find("input[type='email']");
    const passwordInput = wrapper.find("input[type='password']");
    await emailInput.setValue("test@example.com");
    await passwordInput.setValue("password123");

    // Submit the form
    await wrapper.find("form").trigger("submit");

    await vi.waitFor(() => {
      expect(mocks.login).toHaveBeenCalledWith("test@example.com", "password123");
    });
  });

  it("shows error message on login failure", async () => {
    mocks.login.mockRejectedValueOnce({ data: { message: "Invalid credentials" } });

    const wrapper = mountPage();

    const emailInput = wrapper.find("input[type='email']");
    const passwordInput = wrapper.find("input[type='password']");
    await emailInput.setValue("test@example.com");
    await passwordInput.setValue("password123");

    await wrapper.find("form").trigger("submit");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Invalid credentials");
    });
  });

  it("shows fallback error message when no data.message", async () => {
    mocks.login.mockRejectedValueOnce(new Error("network"));

    const wrapper = mountPage();

    const emailInput = wrapper.find("input[type='email']");
    const passwordInput = wrapper.find("input[type='password']");
    await emailInput.setValue("test@example.com");
    await passwordInput.setValue("password123");

    await wrapper.find("form").trigger("submit");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Invalid email or password");
    });
  });
});
