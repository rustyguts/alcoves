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
  UApp: { template: "<div><slot /></div>" },
  PageCard: { template: "<div><slot /></div>" },
  AuthForm: {
    template: `<div><slot name="description" /><slot name="footer" /><button data-testid="submit" @click="$emit('submit', { data: { name: 'Test', email: 'test@example.com', password: 'password123', confirmPassword: 'password123' }})">Submit</button></div>`,
    props: ["schema", "fields", "title", "icon", "submit"],
    emits: ["submit"],
  },
  Separator: { template: "<hr />" },
  Button: {
    template: "<button><slot /></button>",
    props: ["color", "variant", "block", "to", "external"],
  },
  Link: { template: "<a><slot /></a>", props: ["to"] },
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
    const submitButton = wrapper.find("[data-testid='submit']");
    await submitButton.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.register).toHaveBeenCalledWith("Test", "test@example.com", "password123");
    });
  });

  it("shows error message on register failure", async () => {
    mocks.register.mockRejectedValueOnce({ data: { message: "Email taken" } });

    const wrapper = mountPage();
    const submitButton = wrapper.find("[data-testid='submit']");
    await submitButton.trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Email taken");
    });
  });

  it("shows fallback error message when no data.message", async () => {
    mocks.register.mockRejectedValueOnce(new Error("fail"));

    const wrapper = mountPage();
    const submitButton = wrapper.find("[data-testid='submit']");
    await submitButton.trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Registration failed");
    });
  });
});
