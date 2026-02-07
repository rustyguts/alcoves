import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import App from "~/app.vue";

const mocks = vi.hoisted(() => ({
  hasInFlightUploads: false,
}));

mockNuxtImport("useUploadQueue", () => {
  return () => ({
    hasInFlightUploads: {
      get value() {
        return mocks.hasInFlightUploads;
      },
      set value(value: boolean) {
        mocks.hasInFlightUploads = value;
      },
    },
  });
});

describe("app.vue", () => {
  beforeEach(() => {
    mocks.hasInFlightUploads = false;
  });

  it("registers beforeunload handler and only blocks navigation when uploads are in flight", async () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");

    const wrapper = await mountSuspended(App, {
      global: {
        stubs: {
          UApp: { template: "<div><slot /></div>" },
          NuxtRouteAnnouncer: { template: "<div />" },
          NuxtLayout: { template: "<div><slot /></div>" },
          NuxtPage: { template: "<div />" },
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
