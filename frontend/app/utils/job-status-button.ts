export type JobStatus = "queued" | "processing" | "ready" | "failed" | null | undefined;

export type JobButtonColor = "primary" | "neutral" | "warning" | "error";

export interface JobStatusButton {
  label: string;
  color: JobButtonColor;
  loading: boolean;
  disabled: boolean;
}

export interface JobStatusLabels {
  idle: string;
  inFlight: string;
  inFlightWithProgress: (pct: number) => string;
  failed: string;
  ready: string;
}

export function jobStatusButton(
  status: JobStatus,
  progress: number | null | undefined,
  labels: JobStatusLabels,
): JobStatusButton {
  if (status === "processing" || status === "queued") {
    const label = progress != null ? labels.inFlightWithProgress(progress) : labels.inFlight;
    return { label, color: "warning", loading: true, disabled: true };
  }
  if (status === "failed") {
    return { label: labels.failed, color: "error", loading: false, disabled: false };
  }
  if (status === "ready") {
    return { label: labels.ready, color: "neutral", loading: false, disabled: false };
  }
  return { label: labels.idle, color: "primary", loading: false, disabled: false };
}
