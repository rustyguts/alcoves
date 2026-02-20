import { mount } from "@vue/test-utils";
import AdminJobsPanel from "~/components/admin/AdminJobsPanel.vue";

const mocks = vi.hoisted(() => ({
  toast: { add: vi.fn() },
  apiFetch: vi.fn().mockResolvedValue({ total: 5 }),
}));

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    });
  }

  close() {
    this.readyState = 2;
  }

  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  simulateError() {
    this.onerror?.(new Event("error"));
  }
}

function getSnapshot(overrides?: Partial<{ queues: unknown[]; jobs: unknown[] }>) {
  return {
    queues: [
      { name: "{video-processing}", waiting: 2, active: 1, completed: 10, failed: 1, delayed: 0 },
      { name: "{face-detection}", waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0 },
    ],
    jobs: [
      {
        id: "job-1",
        queueName: "{video-processing}",
        name: "process-video",
        data: { fileId: "file-1" },
        progress: 60,
        attemptsMade: 0,
        failedReason: null,
        timestamp: 1700000000000,
        processedOn: 1700000001000,
        finishedOn: null,
        state: "active",
      },
      {
        id: "job-2",
        queueName: "{video-processing}",
        name: "process-video",
        data: { fileId: "file-2" },
        progress: 0,
        attemptsMade: 2,
        failedReason: "ffmpeg crash",
        timestamp: 1699999000000,
        processedOn: 1699999001000,
        finishedOn: 1699999010000,
        state: "failed",
      },
      {
        id: "job-3",
        queueName: "{face-detection}",
        name: "detect-faces",
        data: {},
        progress: 0,
        attemptsMade: 0,
        failedReason: null,
        timestamp: 1700000500000,
        processedOn: null,
        finishedOn: null,
        state: "waiting",
      },
    ],
    ...overrides,
  };
}

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
};

describe("AdminJobsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("EventSource", MockEventSource);
    MockEventSource.instances = [];
  });

  async function mountPanel(props: Record<string, unknown> = {}) {
    const wrapper = mount(AdminJobsPanel, {
      props: { embedded: false, ...props },
      global: { stubs },
    });
    await vi.dynamicImportSettled();
    return wrapper;
  }

  it("renders heading as h1 when not embedded", async () => {
    const wrapper = await mountPanel();
    expect(wrapper.find("h1").exists()).toBe(true);
    expect(wrapper.find("h1").text()).toBe("Background Jobs");
  });

  it("renders heading as h2 when embedded", async () => {
    const wrapper = await mountPanel({ embedded: true });
    expect(wrapper.find("h2").exists()).toBe(true);
    expect(wrapper.find("h2").text()).toBe("Background Jobs");
  });

  it("shows Live status after SSE connects", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Live");
  });

  it("shows Disconnected status on SSE error", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateError();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Disconnected");
  });

  it("renders queue table from snapshot data", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("video processing");
    expect(wrapper.text()).toContain("face detection");
  });

  it("renders stat counters from snapshot queues", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    // totalActive = 1, totalWaiting = 2, totalFailed = 1, totalDelayed = 0
    const text = wrapper.text();
    expect(text).toContain("Active");
    expect(text).toContain("Waiting");
    expect(text).toContain("Failed");
    expect(text).toContain("Delayed");
  });

  it("renders jobs table with job entries", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("process-video");
    expect(wrapper.text()).toContain("detect-faces");
    expect(wrapper.text()).toContain("3 jobs");
  });

  it("shows progress bar for active jobs", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("60%");
    expect(wrapper.find("progress.progress-info").exists()).toBe(true);
  });

  it("expands job detail on row click", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    // The jobs table is the second table element (first is queues table)
    const jobsTable = wrapper.findAll("table")[1]!;
    const rows = jobsTable.findAll("tbody tr");
    await rows[0]!.trigger("click");
    await wrapper.vm.$nextTick();

    // Should show job ID in detail
    expect(wrapper.text()).toContain("job-1");
  });

  it("shows failure reason when expanding failed job", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    // The jobs table is the second table. Sorted order: active job-1, waiting job-3, failed job-2
    // Each visible job has one <tr>; clicking a row expands a detail <tr>.
    // We need to find the failed job row — it has "failed" badge text.
    const jobRows = wrapper
      .findAll("table")[1]!
      .findAll("tbody tr")
      .filter((r) => r.text().includes("failed"));
    expect(jobRows.length).toBeGreaterThan(0);
    await jobRows[0]!.trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("ffmpeg crash");
  });

  it("shows retry and remove buttons for failed jobs", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll("button[data-tip='Retry']")).toHaveLength(1);
    expect(wrapper.findAll("button[data-tip='Remove']")).toHaveLength(1);
  });

  it("calls retry API on retry button click", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    await wrapper.find("button[data-tip='Retry']").trigger("click");
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/jobs/%7Bvideo-processing%7D/job-2", {
      method: "POST",
      body: { action: "retry" },
    });
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Job retried" });
  });

  it("calls remove API on remove button click", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    await wrapper.find("button[data-tip='Remove']").trigger("click");
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/jobs/%7Bvideo-processing%7D/job-2", {
      method: "POST",
      body: { action: "remove" },
    });
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Job removed" });
  });

  it("shows empty state when no jobs match filters", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot({ jobs: [] }));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("No jobs matching current filters.");
  });

  it("shows loading dots when disconnected and no jobs", () => {
    // Mount synchronously — before the queueMicrotask fires, connected=false and jobs=[]
    const wrapper = mount(AdminJobsPanel, {
      props: { embedded: false },
      global: { stubs },
    });
    expect(wrapper.find(".loading.loading-dots").exists()).toBe(true);
  });

  it("closes EventSource on unmount", async () => {
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    const closeSpy = vi.spyOn(es, "close");
    wrapper.unmount();
    expect(closeSpy).toHaveBeenCalled();
  });

  it("calls purge API with confirmation", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    const purgeButtons = wrapper.findAll("button").filter((b) => b.text().includes("Purge Jobs"));
    expect(purgeButtons.length).toBeGreaterThan(0);
    await purgeButtons[0]!.trigger("click");

    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/jobs/%7Bvideo-processing%7D/purge", {
      method: "POST",
    });
    vi.unstubAllGlobals();
    vi.stubGlobal("EventSource", MockEventSource);
  });

  it("does not purge when confirmation is cancelled", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    const wrapper = await mountPanel();
    await wrapper.vm.$nextTick();
    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    const purgeButtons = wrapper.findAll("button").filter((b) => b.text().includes("Purge Jobs"));
    await purgeButtons[0]!.trigger("click");

    expect(mocks.apiFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.stubGlobal("EventSource", MockEventSource);
  });
});
