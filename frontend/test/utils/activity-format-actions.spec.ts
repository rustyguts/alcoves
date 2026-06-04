import { describe, it, expect } from "vitest";
import { formatActivity, relativeTime, type ActivityGroup } from "~/utils/activity-format";
import type { Activity } from "~~/shared/types/api";

function makeActivity(over: Partial<Activity> = {}): Activity {
  return {
    id: over.id ?? "a1",
    libraryId: over.libraryId ?? "lib-1",
    libraryName: over.libraryName,
    actor: "actor" in over ? over.actor : { id: "u1", displayName: "Alice", avatarUrl: null },
    action: over.action ?? "file.created",
    subjectType: over.subjectType ?? "file",
    subjectId: over.subjectId ?? "s1",
    metadata: over.metadata ?? {},
    createdAt: over.createdAt ?? "2026-01-01T00:00:00Z",
    dismissed: over.dismissed ?? false,
  };
}

function group(
  action: Activity["action"],
  over: Partial<Activity> = {},
  count = 1,
): ActivityGroup {
  const head = makeActivity({ action, ...over });
  return { head, items: [head], count };
}

describe("formatActivity — all action branches", () => {
  it("formats bulk file.deleted as a count with no href", () => {
    const out = formatActivity(group("file.deleted", {}, 3));
    expect(out.text).toBe("Alice deleted 3 files");
    expect(out.href).toBeNull();
  });

  it("formats folder.created with a folder deep-link", () => {
    const out = formatActivity(
      group("folder.created", { subjectType: "folder", subjectId: "fo1", metadata: { name: "Trips" } }),
    );
    expect(out.text).toBe("Alice created folder Trips");
    expect(out.href).toBe("/libraries/lib-1?folderId=fo1");
  });

  it("formats folder.deleted with no href", () => {
    const out = formatActivity(group("folder.deleted", { metadata: { name: "Old" } }));
    expect(out.text).toBe("Alice deleted folder Old");
    expect(out.href).toBeNull();
  });

  it("formats tag.created linking to the tags page", () => {
    const out = formatActivity(group("tag.created", { metadata: { name: "blue" } }));
    expect(out.text).toBe("Alice created tag blue");
    expect(out.href).toBe("/libraries/lib-1/tags");
  });

  it("formats moment.created with an editor deep-link", () => {
    const out = formatActivity(
      group("moment.created", { subjectId: "m1", metadata: { name: "Goal", fileId: "f9" } }),
    );
    expect(out.text).toBe("Alice created moment Goal");
    expect(out.href).toBe("/libraries/lib-1/edit/f9?momentId=m1");
  });

  it("formats moment.shared, falling back to the library href without fileId", () => {
    const out = formatActivity(group("moment.shared", { metadata: { momentName: "Clip" } }));
    expect(out.text).toBe("Alice shared moment Clip");
    expect(out.href).toBe("/libraries/lib-1");
  });

  it("formats member.removed", () => {
    const out = formatActivity(group("member.removed", { metadata: { displayName: "Bob" } }));
    expect(out.text).toBe("Alice removed Bob");
    expect(out.href).toBe("/libraries/lib-1/settings");
  });

  it("formats system.transcribe_ready and system.video_proxy_ready", () => {
    expect(formatActivity(group("system.transcribe_ready", { metadata: { fileName: "a.mp4" } })).text).toBe(
      "Transcript ready for a.mp4",
    );
    expect(formatActivity(group("system.video_proxy_ready", { metadata: { fileName: "b.mp4" } })).text).toBe(
      "Video processed for b.mp4",
    );
  });

  it("falls back to a generic bell for unknown actions", () => {
    const out = formatActivity(group("something.weird" as Activity["action"]));
    expect(out.icon).toMatch(/bell/);
    expect(out.text).toContain("something.weird");
    expect(out.href).toBeNull();
  });

  it("uses 'System' when there is no actor", () => {
    const out = formatActivity(group("file.deleted", { actor: null, metadata: { name: "x" } }));
    expect(out.text).toBe("System deleted x");
  });

  it("links bulk file.created to the parent folder from metadata", () => {
    const out = formatActivity(group("file.created", { metadata: { parentFolderId: "pf1" } }, 4));
    expect(out.href).toBe("/libraries/lib-1?folderId=pf1");
  });

  it("links bulk file.created to the library root when no parent folder", () => {
    const out = formatActivity(group("file.created", {}, 4));
    expect(out.href).toBe("/libraries/lib-1");
  });
});

describe("relativeTime — unit ladder", () => {
  const base = Date.parse("2026-06-01T00:00:00Z");
  const ago = (seconds: number) => relativeTime(new Date(base - seconds * 1000).toISOString(), base);

  it("climbs through m/h/d/w/mo/y", () => {
    expect(ago(90)).toBe("1m");
    expect(ago(3 * 3600)).toBe("3h");
    expect(ago(2 * 86400)).toBe("2d");
    expect(ago(14 * 86400)).toBe("2w");
    expect(ago(60 * 86400)).toMatch(/mo$/);
    expect(ago(400 * 86400)).toMatch(/y$/);
  });

  it("clamps future timestamps to 0s", () => {
    expect(relativeTime(new Date(base + 5000).toISOString(), base)).toBe("0s");
  });
});
