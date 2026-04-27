import { ref, watch, type Ref } from "vue";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";
import type { Moment } from "~~/shared/types/api";

function isMomentReady(m: Moment): boolean {
  return m.exportStatus === "ready" && m.exportedVersion === m.exportVersion;
}

/**
 * "Download when ready" queue: callers ask for a moment download; if the
 * export is fresh we redirect immediately, otherwise we trigger an export
 * and watch the moments list — once it lands we redirect to the file.
 */
export function useMomentDownloads(
  libraryId: Ref<string>,
  fileId: Ref<string>,
  moments: Ref<Moment[]>,
  triggerExport: (momentId: string) => Promise<unknown>,
) {
  const toast = useToast();
  const pendingIds = ref<Set<string>>(new Set());

  function isPending(id: string) {
    return pendingIds.value.has(id);
  }

  function navigateToDownload(momentId: string) {
    window.location.href = api.moments.downloadUrl(libraryId.value, fileId.value, momentId);
  }

  async function request(momentId: string) {
    const m = moments.value.find((x) => x.id === momentId);
    if (!m) return;
    if (isMomentReady(m)) {
      navigateToDownload(momentId);
      return;
    }
    pendingIds.value = new Set([...pendingIds.value, momentId]);
    try {
      await triggerExport(momentId);
      toast.add({ title: "Processing clip…", color: "info" });
    } catch {
      const next = new Set(pendingIds.value);
      next.delete(momentId);
      pendingIds.value = next;
      toast.add({ title: "Failed to start export", color: "error" });
    }
  }

  watch(
    moments,
    (list) => {
      if (pendingIds.value.size === 0) return;
      const next = new Set(pendingIds.value);
      let changed = false;
      for (const id of [...pendingIds.value]) {
        const m = list.find((x) => x.id === id);
        if (!m) {
          next.delete(id);
          changed = true;
          continue;
        }
        if (isMomentReady(m)) {
          next.delete(id);
          changed = true;
          navigateToDownload(id);
        } else if (m.exportStatus === "failed") {
          next.delete(id);
          changed = true;
          toast.add({ title: "Export failed", color: "error" });
        }
      }
      if (changed) pendingIds.value = next;
    },
    { deep: true },
  );

  return { pendingIds, isPending, request };
}
