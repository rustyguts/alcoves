import type { Page } from "@playwright/test";

export async function installTusStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tusGlobal = (globalThis as unknown as { tus?: unknown }).tus;
    if (!tusGlobal) return;

    const original = (tusGlobal as { Upload?: unknown }).Upload;
    if (!original) return;

    class StubUpload {
      file: File;
      options: {
        onProgress?: (bytesSent: number, bytesTotal: number) => void;
        onSuccess?: () => void;
        onError?: (err: Error) => void;
      };
      url: string | null = null;
      private timer: ReturnType<typeof setInterval> | null = null;

      constructor(file: File, options: Record<string, unknown>) {
        this.file = file;
        this.options = options;
      }

      start(): void {
        this.url = `/api/tus/stub-${Math.random().toString(36).slice(2, 8)}`;
        const total = this.file.size || 1024;
        let sent = 0;
        const step = Math.max(1, Math.floor(total / 5));
        this.timer = setInterval(() => {
          sent = Math.min(sent + step, total);
          this.options.onProgress?.(sent, total);
          if (sent >= total) {
            if (this.timer) clearInterval(this.timer);
            this.timer = null;
            this.options.onSuccess?.();
          }
        }, 40);
      }

      abort(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        return Promise.resolve();
      }
    }

    (tusGlobal as Record<string, unknown>).Upload = StubUpload;
  });
}
