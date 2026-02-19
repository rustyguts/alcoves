import { mount } from "@vue/test-utils";
import RegisterPage from "~/pages/register.vue";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  mockRouter: { push: vi.fn(), replace: vi.fn() },
  mockRoute: { query: {} } as { query: Record<string, string> },
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    register: mocks.register,
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

describe("register.vue", () => {
  beforeEach(() => {
    mocks.register.mockReset();
    mocks.mockRouter.push.mockReset();
    mocks.mockRoute.query = {};
  });

  function mountPage() {
    return mount(RegisterPage, { global: { stubs } });
  }

  it("renders register page", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Get started with Alcoves");
  });

  it("shows link to login page", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Sign in");
  });

  it("calls register on form submit", async () => {
    mocks.register.mockResolvedValueOnce({});

    const wrapper = mountPage();

    // Fill in the form fields
    const inputs = wrapper.findAll("input");
    const nameInput = inputs.find((i) => i.attributes("type") === "text");
    const emailInput = inputs.find((i) => i.attributes("type") === "email");
    const passwordInputs = inputs.filter((i) => i.attributes("type") === "password");

    await nameInput!.setValue("Test");
    await emailInput!.setValue("test@example.com");
    await passwordInputs[0]!.setValue("password123");
    await passwordInputs[1]!.setValue("password123");

    // Submit the form
    await wrapper.find("form").trigger("submit");

    await vi.waitFor(() => {
      expect(mocks.register).toHaveBeenCalledWith("Test", "test@example.com", "password123");
    });
  });

  it("shows error message on register failure", async () => {
    mocks.register.mockRejectedValueOnce({ data: { message: "Email taken" } });

    const wrapper = mountPage();

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

    const wrapper = mountPage();

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
});
