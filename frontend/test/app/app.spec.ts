import { mount } from "@vue/test-utils";
import App from "~/app.vue";

const mocks = vi.hoisted(() => ({
  hasInFlightUploads: false,
}));

vi.mock("~/composables/useUploadQueue", () => ({
  useUploadQueue: () => ({
    hasInFlightUploads: {
      get value() {
        return mocks.hasInFlightUploads;
      },
      set value(value: boolean) {
        mocks.hasInFlightUploads = value;
      },
    },
  }),
}));

vi.mock("~/composables/useTheme", () => ({
  useTheme: () => ({
    theme: { value: "light" },
    preference: { value: "auto" },
  }),
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRoute: () => ({
      path: "/",
      meta: { layout: "dashboard" },
      query: {},
      params: {},
    }),
    RouterLink: { template: "<a><slot /></a>", props: ["to"] },
  };
});

describe("app.vue", () => {
  beforeEach(() => {
    mocks.hasInFlightUploads = false;
  });

  it("registers beforeunload handler and only blocks navigation when uploads are in flight", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");

    const wrapper = mount(App, {
      global: {
        stubs: {
          App: { template: "<div><slot /></div>" },
          RouterView: { template: "<div />" },
          DashboardLayout: { template: "<div><slot /></div>" },
          UploadProgress: { template: "<div />" },
        },
      },
    });

    const attachCall = addListener.mock.calls.find((call) => call[0] === "beforeunload");
    expect(attachCall).toBeDefined();

    const handler = attachCall?.[1] as (event: BeforeUnloadEvent) => void;

    const safeEvent = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(safeEvent, "returnValue", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    mocks.hasInFlightUploads = false;
    handler(safeEvent);
    expect(safeEvent.defaultPrevented).toBe(false);
    expect(safeEvent.returnValue).toBeUndefined();

    const blockingEvent = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(blockingEvent, "returnValue", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    mocks.hasInFlightUploads = true;
    handler(blockingEvent);

    expect(blockingEvent.defaultPrevented).toBe(true);
    expect(blockingEvent.returnValue).toBe("");

    wrapper.unmount();

    const detachCall = removeListener.mock.calls.find((call) => call[0] === "beforeunload");
    expect(detachCall?.[1]).toBe(handler);
  });
});
