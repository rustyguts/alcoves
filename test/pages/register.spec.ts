import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import RegisterPage from "~/pages/register.vue";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  navigateTo: vi.fn(),
}));

mockNuxtImport("useAuth", () => () => ({
  register: mocks.register,
}));

mockNuxtImport("navigateTo", () => mocks.navigateTo);

mockNuxtImport("useUserSession", () => () => ({
  loggedIn: { value: false },
  user: { value: null },
  fetch: vi.fn().mockResolvedValue(null),
  clear: vi.fn(),
}));

const stubs = {
  UApp: { template: "<div><slot /></div>" },
  UPageCard: { template: "<div><slot /></div>" },
  UAuthForm: {
    template: `<div><slot name="description" /><slot name="footer" /><button data-testid="submit" @click="$emit('submit', { data: { name: 'Test', email: 'test@example.com', password: 'password123', confirmPassword: 'password123' }})">Submit</button></div>`,
    props: ["schema", "fields", "title", "icon", "submit"],
    emits: ["submit"],
  },
  USeparator: { template: "<hr />" },
  UButton: { template: "<button><slot /></button>", props: ["color", "variant", "block", "to", "external"] },
  ULink: { template: "<a><slot /></a>", props: ["to"] },
};

describe("register.vue", () => {
  beforeEach(() => {
    mocks.register.mockReset();
    mocks.navigateTo.mockReset();
  });

  async function mountPage() {
    return mountSuspended(RegisterPage, { global: { stubs } });
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
    const submitButton = wrapper.find("[data-testid='submit']");
    await submitButton.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.register).toHaveBeenCalledWith("Test", "test@example.com", "password123");
    });
  });

  it("shows error message on register failure", async () => {
    mocks.register.mockRejectedValueOnce({ data: { message: "Email taken" } });

    const wrapper = await mountPage();
    const submitButton = wrapper.find("[data-testid='submit']");
    await submitButton.trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Email taken");
    });
  });

  it("shows fallback error message when no data.message", async () => {
    mocks.register.mockRejectedValueOnce(new Error("fail"));

    const wrapper = await mountPage();
    const submitButton = wrapper.find("[data-testid='submit']");
    await submitButton.trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Registration failed");
    });
  });
});
