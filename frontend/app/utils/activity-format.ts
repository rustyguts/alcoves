import type { Activity, ActivityAction } from "~~/shared/types/api";

// ActivityGroup is one display row in the feed UI. It bundles one or more
// raw Activity rows that occurred close together from the same actor on
// the same parent — e.g. ten file.created rows become a single
// "Brendan added 10 files" group.
export interface ActivityGroup {
  // The most recent row in the group provides the display fields.
  head: Activity;
  // All rows in chronological-DESC order (matches API ordering).
  items: Activity[];
  // Total count across all rows in the group (sums the metadata.count
  // field for actions like file.deleted that batch in the backend).
  count: number;
}

const FIVE_MINUTES = 5 * 60 * 1000;
const MAX_GROUP_SIZE = 20;

// Actions that may merge into a single display row when consecutive,
// from the same actor, with the same parent folder, within 5 minutes.
// System and member events never merge.
const MERGEABLE: Record<ActivityAction, boolean> = {
  "file.created": true,
  "file.deleted": true,
  "folder.created": true,
  "folder.renamed": false,
  "folder.deleted": false,
  "tag.created": true,
  "moment.created": true,
  "moment.shared": false,
  "member.joined": false,
  "member.removed": false,
  "system.waveform_ready": false,
  "system.transcribe_ready": false,
  "system.video_proxy_ready": false,
};

function parentOf(a: Activity): string | null {
  const md = a.metadata as { parentFolderId?: string | null } | undefined;
  return md?.parentFolderId ?? null;
}

/**
 * Group consecutive activities by (actor, action, library, parent_folder)
 * inside a 5-minute window. Input must be sorted DESC by createdAt — the
 * API returns rows that way already.
 */
export function groupActivities(rows: Activity[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const mergeable = MERGEABLE[row.action] ?? false;
    if (mergeable && last) {
      const lastHead = last.head;
      const sameActor = (last.head.actor?.id ?? null) === (row.actor?.id ?? null);
      const sameAction = lastHead.action === row.action;
      const sameLibrary = lastHead.libraryId === row.libraryId;
      const sameParent = parentOf(lastHead) === parentOf(row);
      const lastItem = last.items[last.items.length - 1] ?? last.head;
      const lastTime = Date.parse(lastItem.createdAt);
      const rowTime = Date.parse(row.createdAt);
      const withinWindow = !isNaN(lastTime) && !isNaN(rowTime) && lastTime - rowTime <= FIVE_MINUTES;
      if (sameActor && sameAction && sameLibrary && sameParent && withinWindow && last.items.length < MAX_GROUP_SIZE) {
        last.items.push(row);
        last.count += rawCount(row);
        continue;
      }
    }
    groups.push({ head: row, items: [row], count: rawCount(row) });
  }
  return groups;
}

function rawCount(a: Activity): number {
  const c = (a.metadata as { count?: number } | undefined)?.count;
  return typeof c === "number" && c > 0 ? c : 1;
}

// FormattedActivity is what the components render: icon, text, optional
// deep-link href, and a friendly relative time.
export interface FormattedActivity {
  icon: string;
  text: string;
  href: string | null;
}

function actorName(g: ActivityGroup): string {
  return g.head.actor?.displayName ?? "System";
}

function hrefForFile(g: ActivityGroup): string | null {
  if (g.head.subjectType !== "file" || !g.head.subjectId) return null;
  return `/libraries/${g.head.libraryId}?fileId=${g.head.subjectId}`;
}

function hrefForFolder(g: ActivityGroup): string | null {
  const md = g.head.metadata as { parentFolderId?: string | null } | undefined;
  if (g.head.subjectType === "folder" && g.head.subjectId) {
    return `/libraries/${g.head.libraryId}?folderId=${g.head.subjectId}`;
  }
  if (md?.parentFolderId) {
    return `/libraries/${g.head.libraryId}?folderId=${md.parentFolderId}`;
  }
  return `/libraries/${g.head.libraryId}`;
}

function hrefForMoment(g: ActivityGroup): string | null {
  const md = g.head.metadata as { fileId?: string } | undefined;
  if (md?.fileId && g.head.subjectId) {
    return `/libraries/${g.head.libraryId}/edit/${md.fileId}?momentId=${g.head.subjectId}`;
  }
  return `/libraries/${g.head.libraryId}`;
}

export function formatActivity(g: ActivityGroup): FormattedActivity {
  const actor = actorName(g);
  const md = (g.head.metadata ?? {}) as Record<string, unknown>;
  switch (g.head.action) {
    case "file.created":
      if (g.count <= 1) {
        const name = (md.name as string) ?? "a file";
        return { icon: "i-lineicons-file-plus-circle", text: `${actor} added ${name}`, href: hrefForFile(g) };
      }
      return { icon: "i-lineicons-files", text: `${actor} added ${g.count} files`, href: hrefForFolder(g) };
    case "file.deleted": {
      if (g.count <= 1) {
        const name = (md.name as string) ?? "a file";
        return { icon: "i-lineicons-trash-can", text: `${actor} deleted ${name}`, href: null };
      }
      return { icon: "i-lineicons-trash-can", text: `${actor} deleted ${g.count} files`, href: null };
    }
    case "folder.created":
      return {
        icon: "i-lineicons-folder",
        text: `${actor} created folder ${(md.name as string) ?? ""}`,
        href: hrefForFolder(g),
      };
    case "folder.renamed":
      return {
        icon: "i-lineicons-pencil",
        text: `${actor} renamed ${(md.oldName as string) ?? "a folder"} → ${(md.newName as string) ?? ""}`,
        href: hrefForFolder(g),
      };
    case "folder.deleted":
      return {
        icon: "i-lineicons-folder",
        text: `${actor} deleted folder ${(md.name as string) ?? ""}`,
        href: null,
      };
    case "tag.created":
      return {
        icon: "i-lineicons-tag",
        text: `${actor} created tag ${(md.name as string) ?? ""}`,
        href: `/libraries/${g.head.libraryId}/tags`,
      };
    case "moment.created":
      return {
        icon: "i-lineicons-camera-movie-1",
        text: `${actor} created moment ${(md.name as string) ?? ""}`,
        href: hrefForMoment(g),
      };
    case "moment.shared":
      return {
        icon: "i-lineicons-share-2",
        text: `${actor} shared moment ${(md.momentName as string) ?? ""}`,
        href: hrefForMoment(g),
      };
    case "member.joined":
      return {
        icon: "i-lineicons-user-4",
        text: `${(md.displayName as string) ?? actor} joined`,
        href: `/libraries/${g.head.libraryId}/settings`,
      };
    case "member.removed":
      return {
        icon: "i-lineicons-user",
        text: `${actor} removed ${(md.displayName as string) ?? "a member"}`,
        href: `/libraries/${g.head.libraryId}/settings`,
      };
    case "system.waveform_ready":
      return {
        icon: "i-lineicons-pulse",
        text: `Waveform ready for ${(md.fileName as string) ?? "a file"}`,
        href: hrefForFile(g),
      };
    case "system.transcribe_ready":
      return {
        icon: "i-lineicons-comment-1-text",
        text: `Transcript ready for ${(md.fileName as string) ?? "a file"}`,
        href: hrefForFile(g),
      };
    case "system.video_proxy_ready":
      return {
        icon: "i-lineicons-video",
        text: `Video processed for ${(md.fileName as string) ?? "a file"}`,
        href: hrefForFile(g),
      };
    default:
      return { icon: "i-lineicons-bell-1", text: `${actor} ${g.head.action}`, href: null };
  }
}

// REL_UNITS: [step, label-AFTER-dividing-by-step]. Starting unit is "s";
// after dividing by 60 the unit becomes "m"; after another 60 → "h"; etc.
const REL_UNITS: Array<[number, string]> = [
  [60, "m"],
  [60, "h"],
  [24, "d"],
  [7, "w"],
  [4.345, "mo"],
  [12, "y"],
];

// Short relative-time formatter. Skips dependency on date-fns/dayjs.
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  let diff = Math.max(0, Math.floor((now - t) / 1000));
  let unit = "s";
  for (const [step, label] of REL_UNITS) {
    if (diff < step) return `${diff}${unit}`;
    diff = Math.floor(diff / step);
    unit = label;
  }
  return `${diff}${unit}`;
}
