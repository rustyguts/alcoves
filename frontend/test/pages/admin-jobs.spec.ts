import { mount } from "@vue/test-utils";
import AdminJobsPage from "~/pages/admin/jobs.vue";

const mocks = vi.hoisted(() => ({
  toast: { add: vi.fn() },
  apiFetch: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@nuxt/ui/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    RouterLink: {
      template: "<a :href='to'><slot /></a>",
      props: ["to"],
    },
  };
});

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

// Mock EventSource
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
    // Auto-trigger open
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
      { name: "{thumbnails}", waiting: 1, active: 0, completed: 20, failed: 0, delayed: 0 },
    ],
    jobs: [
      {
        id: "job-1",
        queueName: "{video-processing}",
        name: "process-video",
        data: { fileId: "file-1", libraryId: "lib-abc123" },
        progress: 45,
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
        data: { fileId: "file-2", libraryId: "lib-def456" },
        progress: 0,
        attemptsMade: 3,
        failedReason: "ffmpeg exited with code 1",
        timestamp: 1699999000000,
        processedOn: 1699999001000,
        finishedOn: 1699999010000,
        state: "failed",
      },
      {
        id: "job-3",
        queueName: "{face-detection}",
        name: "detect-faces",
        data: { fileId: "file-3", libraryId: "lib-abc123" },
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

describe("admin/jobs.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("EventSource", MockEventSource);
    MockEventSource.instances = [];
  });

  async function mountPage() {
    const wrapper = mount(AdminJobsPage);
    // Wait for SSE to connect
    await vi.dynamicImportSettled();
    return wrapper;
  }

  it("renders the page heading", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Background Jobs");
    expect(wrapper.text()).toContain("Monitor and manage background job queues");
  });

  it("shows connected status when SSE connects", async () => {
    const wrapper = await mountPage();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Connected");
  });

  it("renders queue stat cards from SSE data", async () => {
    const wrapper = await mountPage();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    const text = wrapper.text();
    expect(text).toContain("video processing");
    expect(text).toContain("face detection");
    expect(text).toContain("thumbnails");
  });

  it("renders jobs table with job data", async () => {
    const wrapper = await mountPage();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    const text = wrapper.text();
    expect(text).toContain("process-video");
    expect(text).toContain("detect-faces");
    expect(text).toContain("lib-abc1");
    expect(text).toContain("lib-def4");
  });

  it("shows progress bar for active jobs", async () => {
    const wrapper = await mountPage();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("45%");
  });

  it("shows failure reason for failed jobs", async () => {
    const wrapper = await mountPage();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("ffmpeg exited with code 1");
  });

  it("shows retry and remove buttons for failed jobs", async () => {
    const wrapper = await mountPage();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    // Failed job should have action buttons
    const buttons = wrapper.findAll("button[title='Retry']");
    expect(buttons.length).toBe(1);

    const removeButtons = wrapper.findAll("button[title='Remove']");
    expect(removeButtons.length).toBe(1);
  });

  it("calls retry API when retry button is clicked", async () => {
    const wrapper = await mountPage();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    const retryBtn = wrapper.find("button[title='Retry']");
    await retryBtn.trigger("click");

    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/jobs/%7Bvideo-processing%7D/job-2", {
      method: "POST",
      body: { action: "retry" },
    });
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Job retried" });
  });

  it("calls remove API when remove button is clicked", async () => {
    const wrapper = await mountPage();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    const removeBtn = wrapper.find("button[title='Remove']");
    await removeBtn.trigger("click");

    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/jobs/%7Bvideo-processing%7D/job-2", {
      method: "POST",
      body: { action: "remove" },
    });
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Job removed" });
  });

  it("shows job count", async () => {
    const wrapper = await mountPage();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot());
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("3 jobs");
  });

  it("shows empty state when no jobs match filters", async () => {
    const wrapper = await mountPage();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const es = MockEventSource.instances[0]!;
    es.simulateMessage(getSnapshot({ jobs: [] }));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("No jobs matching current filters");
  });

  it("shows back link to admin page", async () => {
    const wrapper = await mountPage();
    const backLink = wrapper.find("a[href='/admin']");
    expect(backLink.exists()).toBe(true);
  });

  it("closes EventSource on unmount", async () => {
    const wrapper = await mountPage();
    await wrapper.vm.$nextTick();

    const es = MockEventSource.instances[0]!;
    const closeSpy = vi.spyOn(es, "close");
    wrapper.unmount();
    expect(closeSpy).toHaveBeenCalled();
  });
});
