import { describe, it, expect } from "vitest";
import { jobStatusButton, type JobStatusLabels } from "~/utils/job-status-button";

const labels: JobStatusLabels = {
  idle: "Transcribe",
  inFlight: "Transcribing…",
  inFlightWithProgress: (p) => `Transcribing ${p}%`,
  failed: "Retry transcribe",
  ready: "Retranscribe",
};

describe("jobStatusButton", () => {
  it("returns idle/primary when status is null", () => {
    expect(jobStatusButton(null, null, labels)).toEqual({
      label: "Transcribe",
      color: "primary",
      loading: false,
      disabled: false,
    });
  });

  it("returns idle/primary when status is undefined", () => {
    expect(jobStatusButton(undefined, null, labels).color).toBe("primary");
  });

  it("returns warning + loading + disabled when queued", () => {
    expect(jobStatusButton("queued", null, labels)).toEqual({
      label: "Transcribing…",
      color: "warning",
      loading: true,
      disabled: true,
    });
  });

  it("returns warning + loading + disabled when processing", () => {
    expect(jobStatusButton("processing", null, labels).color).toBe("warning");
    expect(jobStatusButton("processing", null, labels).loading).toBe(true);
  });

  it("uses progress label when progress is present and in flight", () => {
    expect(jobStatusButton("processing", 42, labels).label).toBe("Transcribing 42%");
    expect(jobStatusButton("queued", 0, labels).label).toBe("Transcribing 0%");
  });

  it("ignores progress when status is terminal", () => {
    // ready / failed should not show "x%"
    expect(jobStatusButton("ready", 99, labels).label).toBe("Retranscribe");
    expect(jobStatusButton("failed", 50, labels).label).toBe("Retry transcribe");
  });

  it("returns error/non-loading when failed", () => {
    expect(jobStatusButton("failed", null, labels)).toEqual({
      label: "Retry transcribe",
      color: "error",
      loading: false,
      disabled: false,
    });
  });

  it("returns neutral/non-loading when ready", () => {
    expect(jobStatusButton("ready", null, labels)).toEqual({
      label: "Retranscribe",
      color: "neutral",
      loading: false,
      disabled: false,
    });
  });
});
